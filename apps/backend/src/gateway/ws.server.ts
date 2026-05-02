/**
 * Gateway WebSocket Server — manages real-time bidirectional communication
 * between the React UI and the Node.js backend.
 *
 * Uses `@fastify/websocket` to register a `/ws/:sessionId` route on the
 * shared Fastify instance.  Each connection is tracked by sessionId so that
 * backend services can push typed events to the correct client(s).
 *
 * Public surface:
 * - {@link register}    — register the WS plugin + route on Fastify
 * - {@link emit}        — send a typed event to all sockets for a session
 * - {@link onEvent}     — register a handler for a specific incoming event type
 * - {@link connections} — read-only access to the connection map (testing)
 *
 * The module also wires the Confirmation Bus so that `confirmation:request`
 * events are forwarded to clients and `confirmation:response` events from
 * clients resolve the pending confirmation promise.
 *
 * @module gateway/ws.server
 */

import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import * as confirmationBus from '../confirmation/confirmation.bus.js';
import type { ConfirmationRequest } from '../confirmation/confirmation.bus.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of every WebSocket message exchanged between client and server. */
export interface WsMessage {
  type: string;
  data: unknown;
}

/** Handler signature for incoming WebSocket events. */
export type EventHandler = (
  data: unknown,
  sessionId: string,
  socket: WebSocket,
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Active WebSocket connections grouped by sessionId.
 *
 * A single session may have multiple sockets (e.g. the user opens two
 * browser tabs for the same session).
 */
const connectionMap = new Map<string, WebSocket[]>();

/**
 * Registered event handlers keyed by event type.
 * Multiple handlers can be registered for the same type.
 */
const eventHandlers = new Map<string, EventHandler[]>();

// ---------------------------------------------------------------------------
// Public API — connection management
// ---------------------------------------------------------------------------

/**
 * Read-only snapshot of the current connection map.
 * Useful for tests and diagnostics.
 */
export function connections(): ReadonlyMap<string, readonly WebSocket[]> {
  return connectionMap;
}

// ---------------------------------------------------------------------------
// Public API — emit
// ---------------------------------------------------------------------------

/**
 * Send a typed event to every WebSocket connected under the given sessionId.
 *
 * Messages that cannot be sent (e.g. socket already closing) are silently
 * dropped — the cleanup handler will remove stale sockets on the next
 * `close` event.
 *
 * @param sessionId - Target session.
 * @param type      - Event type string (e.g. `"message:token"`).
 * @param data      - Arbitrary payload serialised as JSON.
 */
export function emit(sessionId: string, type: string, data: unknown): void {
  const sockets = connectionMap.get(sessionId);
  if (!sockets) {
    console.log(`[ws] emit(${type}) → no sockets for session ${sessionId.slice(0, 8)}…`);
    return;
  }

  const payload = JSON.stringify({ type, data } satisfies WsMessage);

  let sent = 0;
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
      sent++;
    }
  }
  console.log(`[ws] emit(${type}) → ${sent}/${sockets.length} sockets for session ${sessionId.slice(0, 8)}…`);
}

// ---------------------------------------------------------------------------
// Public API — onEvent
// ---------------------------------------------------------------------------

/**
 * Register a handler that is invoked whenever a client sends an event of
 * the given type.
 *
 * ```ts
 * onEvent('chat:send', (data, sessionId) => {
 *   // handle incoming chat message
 * });
 * ```
 *
 * @param type    - Event type to listen for.
 * @param handler - Callback receiving the event data, sessionId, and raw socket.
 */
export function onEvent(type: string, handler: EventHandler): void {
  const handlers = eventHandlers.get(type) ?? [];
  handlers.push(handler);
  eventHandlers.set(type, handlers);
}

// ---------------------------------------------------------------------------
// Public API — register
// ---------------------------------------------------------------------------

/**
 * Register the `@fastify/websocket` plugin and the `/ws/:sessionId` route
 * on the provided Fastify instance.
 *
 * Must be called **before** `app.listen()`.
 */
export async function register(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  app.get<{ Params: { sessionId: string } }>(
    '/ws/:sessionId',
    { websocket: true },
    (socket, request) => {
      const { sessionId } = request.params;

      addConnection(sessionId, socket);

      socket.on('message', (raw) => {
        handleIncomingMessage(raw, sessionId, socket);
      });

      socket.on('close', () => {
        removeConnection(sessionId, socket);
      });

      socket.on('error', () => {
        removeConnection(sessionId, socket);
      });
    },
  );

  // Wire built-in event handlers (confirmation flow)
  wireConfirmationHandlers();
}

// ---------------------------------------------------------------------------
// Connection helpers (private)
// ---------------------------------------------------------------------------

/**
 * Track a new WebSocket under the given sessionId.
 */
function addConnection(sessionId: string, ws: WebSocket): void {
  const existing = connectionMap.get(sessionId) ?? [];
  existing.push(ws);
  connectionMap.set(sessionId, existing);
  console.log(`[ws] +connection session=${sessionId.slice(0, 8)}… (total=${existing.length})`);
}

/**
 * Remove a specific WebSocket from the connection map.
 * If the session has no remaining sockets the entry is deleted.
 */
function removeConnection(sessionId: string, ws: WebSocket): void {
  const sockets = connectionMap.get(sessionId);
  if (!sockets) return;

  const filtered = sockets.filter((s) => s !== ws);
  if (filtered.length === 0) {
    connectionMap.delete(sessionId);
  } else {
    connectionMap.set(sessionId, filtered);
  }
}

// ---------------------------------------------------------------------------
// Incoming message handling (private)
// ---------------------------------------------------------------------------

/**
 * Parse an incoming WebSocket frame and dispatch to registered handlers.
 *
 * Invalid JSON or messages missing `type` are silently ignored — the
 * client is expected to conform to the {@link WsMessage} shape.
 */
function handleIncomingMessage(
  raw: WebSocket.Data,
  sessionId: string,
  socket: WebSocket,
): void {
  let msg: WsMessage;
  try {
    msg = JSON.parse(String(raw)) as WsMessage;
  } catch {
    // Malformed frame — ignore
    return;
  }

  if (typeof msg.type !== 'string') return;

  const handlers = eventHandlers.get(msg.type);
  if (!handlers) return;

  for (const handler of handlers) {
    try {
      const result = handler(msg.data, sessionId, socket);
      // Swallow async rejections so one bad handler doesn't break others
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => {});
      }
    } catch {
      // Swallow sync errors from individual handlers
    }
  }
}

// ---------------------------------------------------------------------------
// Confirmation Bus wiring (private)
// ---------------------------------------------------------------------------

/**
 * Wire the Confirmation Bus to the WebSocket layer:
 *
 * 1. When the backend needs user confirmation it calls
 *    `confirmationBus.request(...)`.  We expose a helper
 *    {@link emitConfirmationRequest} that the Tool Registry / Confirmation
 *    Bus can call to push the request to the UI.
 *
 * 2. When the UI responds with `confirmation:response`, we call
 *    `confirmationBus.resolve(requestId, approved)` to unblock the
 *    waiting promise.
 */
function wireConfirmationHandlers(): void {
  onEvent(
    'confirmation:response',
    (data: unknown) => {
      const payload = data as { requestId?: string; approved?: boolean };
      if (
        typeof payload?.requestId === 'string' &&
        typeof payload?.approved === 'boolean'
      ) {
        confirmationBus.resolve(payload.requestId, payload.approved);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Confirmation helpers (public)
// ---------------------------------------------------------------------------

/**
 * Emit a `confirmation:request` event to the client for a given session
 * and wait for the user's response via the Confirmation Bus.
 *
 * This is the bridge between the synchronous confirmation flow in the
 * Tool Registry and the asynchronous WebSocket transport.
 *
 * @param sessionId - Session whose client should receive the dialog.
 * @param request   - Confirmation request details.
 * @returns `true` if the user approved, `false` if denied.
 * @throws  ConfirmationTimeoutError if no response within the timeout.
 */
export async function requestConfirmation(
  sessionId: string,
  request: ConfirmationRequest,
): Promise<boolean> {
  // Push the confirmation dialog to the UI
  emit(sessionId, 'confirmation:request', request);

  // Block until the user responds (or timeout fires)
  return confirmationBus.request(request);
}
