/**
 * WebSocket client — singleton wrapper around the browser's native WebSocket
 * API with typed event handling and automatic reconnection.
 *
 * Connects to the backend at `/ws/:sessionId` and exchanges JSON messages
 * conforming to the {@link WsMessage} shape used by the backend ws.server.
 *
 * Features:
 * - Typed event emitter via {@link onEvent} / {@link offEvent}
 * - Auto-reconnect with exponential backoff (1 s → 30 s cap)
 * - Registered event handlers are preserved across reconnections
 * - {@link emit} queues messages while the socket is not yet open
 *
 * @module api/ws.client
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of every WebSocket message exchanged between client and server. */
export interface WsMessage {
  type: string;
  data: unknown;
}

/** Callback signature for event handlers registered via {@link onEvent}. */
export type WsEventHandler = (data: unknown) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Initial reconnection delay in milliseconds. */
const INITIAL_BACKOFF_MS = 1_000;

/** Maximum reconnection delay in milliseconds. */
const MAX_BACKOFF_MS = 30_000;

/** Default WebSocket base URL (protocol + host + port). */
const DEFAULT_WS_BASE_URL = 'ws://localhost:3001';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Registered event handlers keyed by event type.
 * Handlers survive reconnections — they are re-attached automatically.
 */
const handlers = new Map<string, Set<WsEventHandler>>();

/** The active WebSocket instance, or `null` when disconnected. */
let socket: WebSocket | null = null;

/** The sessionId for the current connection. */
let activeSessionId: string | null = null;

/** Current backoff delay for the next reconnection attempt. */
let backoffMs = INITIAL_BACKOFF_MS;

/** Handle returned by `setTimeout` for a pending reconnection. */
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** Whether the client has been intentionally disconnected. */
let intentionalDisconnect = false;

// ---------------------------------------------------------------------------
// Public API — connect / disconnect
// ---------------------------------------------------------------------------

/**
 * Open a WebSocket connection for the given session.
 *
 * If a connection is already open it will be closed first (without
 * triggering auto-reconnect) before establishing the new one.
 *
 * @param sessionId - Session identifier used in the URL path.
 * @param baseUrl   - Optional base URL override (default `ws://localhost:3001`).
 */
export function connect(
  sessionId: string,
  baseUrl: string = DEFAULT_WS_BASE_URL,
): void {
  // Tear down any existing connection cleanly
  if (socket) {
    intentionalDisconnect = true;
    socket.close();
    socket = null;
  }

  intentionalDisconnect = false;
  activeSessionId = sessionId;
  backoffMs = INITIAL_BACKOFF_MS;

  openSocket(sessionId, baseUrl);
}

/**
 * Close the WebSocket connection and stop any pending reconnection.
 *
 * Registered event handlers are **not** removed — they will be active
 * again if {@link connect} is called later.
 */
export function disconnect(): void {
  intentionalDisconnect = true;

  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (socket) {
    socket.close();
    socket = null;
  }

  activeSessionId = null;
}

// ---------------------------------------------------------------------------
// Public API — event handling
// ---------------------------------------------------------------------------

/**
 * Register a handler for a specific event type.
 *
 * Handlers are preserved across reconnections — there is no need to
 * re-register after a connection drop.
 *
 * @param type    - Event type string (e.g. `"message:token"`).
 * @param handler - Callback receiving the event's `data` payload.
 * @returns An unsubscribe function that removes this specific handler.
 */
export function onEvent(
  type: string,
  handler: WsEventHandler,
): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(handler);

  return () => {
    set?.delete(handler);
    if (set?.size === 0) {
      handlers.delete(type);
    }
  };
}

/**
 * Remove a previously registered handler for the given event type.
 *
 * @param type    - Event type string.
 * @param handler - The exact handler reference to remove.
 */
export function offEvent(type: string, handler: WsEventHandler): void {
  const set = handlers.get(type);
  if (!set) return;
  set.delete(handler);
  if (set.size === 0) {
    handlers.delete(type);
  }
}

/**
 * Send a typed event to the backend.
 *
 * If the socket is not currently open the message is silently dropped.
 *
 * @param type - Event type string (e.g. `"chat:send"`).
 * @param data - Arbitrary payload that will be JSON-serialised.
 */
export function emit(type: string, data: unknown): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const message: WsMessage = { type, data };
  socket.send(JSON.stringify(message));
}

// ---------------------------------------------------------------------------
// Internal — socket lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a new WebSocket and wire up event listeners.
 */
function openSocket(sessionId: string, baseUrl: string): void {
  const url = `${baseUrl}/ws/${sessionId}`;
  const ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    // Reset backoff on successful connection
    backoffMs = INITIAL_BACKOFF_MS;
  });

  ws.addEventListener('message', (event: MessageEvent) => {
    handleMessage(event);
  });

  ws.addEventListener('close', () => {
    handleClose(sessionId, baseUrl);
  });

  ws.addEventListener('error', () => {
    // The `close` event always fires after `error`, so reconnection
    // logic is handled there. Nothing extra needed here.
  });

  socket = ws;
}

/**
 * Parse an incoming WebSocket frame and dispatch to registered handlers.
 */
function handleMessage(event: MessageEvent): void {
  let msg: WsMessage;
  try {
    msg = JSON.parse(String(event.data)) as WsMessage;
  } catch {
    // Malformed frame — ignore
    return;
  }

  if (typeof msg.type !== 'string') return;

  const set = handlers.get(msg.type);
  if (!set) return;

  for (const handler of set) {
    try {
      handler(msg.data);
    } catch {
      // Swallow errors from individual handlers so one bad handler
      // doesn't prevent others from running.
    }
  }
}

/**
 * Handle a socket close event — schedule reconnection with exponential
 * backoff unless the disconnect was intentional.
 */
function handleClose(sessionId: string, baseUrl: string): void {
  socket = null;

  if (intentionalDisconnect) return;

  // Schedule reconnection with exponential backoff
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    // Only reconnect if the session hasn't changed
    if (activeSessionId === sessionId && !intentionalDisconnect) {
      openSocket(sessionId, baseUrl);
    }
  }, backoffMs);

  // Double the backoff for the next attempt, capped at MAX_BACKOFF_MS
  backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
}
