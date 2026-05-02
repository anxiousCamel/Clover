/**
 * Chat & Session Routes — Fastify plugin that registers the chat message
 * endpoint and session lifecycle endpoints.
 *
 * Endpoints:
 * - `POST /chat/message`       — queue a user message for processing (202)
 * - `POST /sessions`           — create a new session
 * - `GET  /sessions/:id/history` — retrieve message history
 * - `DELETE /sessions/:id`      — delete session and history (204)
 *
 * The chat message handler is intentionally fire-and-forget: it kicks off
 * {@link orchestrator.handle} in the background and returns 202 immediately
 * so the UI never blocks on a long-running completion.
 *
 * @module gateway/routes/chat.routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as orchestrator from '../../orchestrator/orchestrator.js';
import * as sessionManager from '../../orchestrator/session.manager.js';
import { emit } from '../ws.server.js';

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

/** Body for POST /chat/message */
interface ChatMessageBody {
  sessionId: string;
  content: string;
}

/** Body for POST /sessions */
interface CreateSessionBody {
  workspacePath: string;
}

/** Params for GET /sessions/:id/history and DELETE /sessions/:id */
interface SessionParams {
  id: string;
}

// ---------------------------------------------------------------------------
// JSON Schemas (Fastify validation)
// ---------------------------------------------------------------------------

const chatMessageSchema = {
  body: {
    type: 'object' as const,
    required: ['sessionId', 'content'],
    properties: {
      sessionId: { type: 'string' as const },
      content: { type: 'string' as const, minLength: 1 },
    },
    additionalProperties: false,
  },
};

const createSessionSchema = {
  body: {
    type: 'object' as const,
    required: ['workspacePath'],
    properties: {
      workspacePath: { type: 'string' as const, minLength: 1 },
    },
    additionalProperties: false,
  },
};

const sessionParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'],
    properties: {
      id: { type: 'string' as const },
    },
  },
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin that registers chat and session routes.
 *
 * Registered with a `/api` prefix by the Gateway so that the full paths
 * become `/api/chat/message`, `/api/sessions`, etc.
 */
export default async function chatRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /chat/message ──────────────────────────────────

  /**
   * Accept a user message and queue it for processing.
   *
   * The orchestrator runs asynchronously in the background — tokens and
   * completion events are delivered via WebSocket. The HTTP response
   * returns immediately with 202 so the client is never blocked.
   */
  fastify.post<{ Body: ChatMessageBody }>(
    '/chat/message',
    { schema: chatMessageSchema },
    async (request: FastifyRequest<{ Body: ChatMessageBody }>, reply: FastifyReply) => {
      const { sessionId, content } = request.body;

      // Verify the session exists before queuing
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return reply.status(404).send({
          error: 'Session not found',
          code: 'SESSION_NOT_FOUND',
        });
      }

      // Fire-and-forget: kick off orchestrator in the background
      console.log(`[chat] handle sessionId=${sessionId.slice(0, 8)}…`);
      orchestrator
        .handle(sessionId, content, {
          workspacePath: session.workspace,
          emit: (type: string, data: unknown) => emit(sessionId, type, data),
        })
        .catch((err: unknown) => {
          // Push the error to the client via WebSocket
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.log(`[chat] error for session=${sessionId.slice(0, 8)}…: ${message}`);
          emit(sessionId, 'message:error', { sessionId, error: message });
        });

      return reply.status(202).send({ queued: true });
    },
  );

  // ── POST /sessions ──────────────────────────────────────

  /**
   * Create a new conversation session for the given workspace path.
   *
   * Returns the session id and creation timestamp.
   */
  fastify.post<{ Body: CreateSessionBody }>(
    '/sessions',
    { schema: createSessionSchema },
    async (request: FastifyRequest<{ Body: CreateSessionBody }>, reply: FastifyReply) => {
      const { workspacePath } = request.body;

      const session = sessionManager.createSession(workspacePath);

      return reply.status(201).send({
        sessionId: session.id,
        createdAt: session.created_at,
      });
    },
  );

  // ── GET /sessions/:id/history ───────────────────────────

  /**
   * Retrieve the message history for a session.
   *
   * Returns an array of {@link Message} objects ordered by creation time.
   */
  fastify.get<{ Params: SessionParams }>(
    '/sessions/:id/history',
    { schema: sessionParamsSchema },
    async (request: FastifyRequest<{ Params: SessionParams }>, reply: FastifyReply) => {
      const { id } = request.params;

      const session = sessionManager.getSession(id);
      if (!session) {
        return reply.status(404).send({
          error: 'Session not found',
          code: 'SESSION_NOT_FOUND',
        });
      }

      const history = sessionManager.loadHistory(id);
      return reply.send(history);
    },
  );

  // ── DELETE /sessions/:id ────────────────────────────────

  /**
   * Delete a session and all associated message history.
   *
   * Returns 204 No Content on success.
   */
  fastify.delete<{ Params: SessionParams }>(
    '/sessions/:id',
    { schema: sessionParamsSchema },
    async (request: FastifyRequest<{ Params: SessionParams }>, reply: FastifyReply) => {
      const { id } = request.params;

      const session = sessionManager.getSession(id);
      if (!session) {
        return reply.status(404).send({
          error: 'Session not found',
          code: 'SESSION_NOT_FOUND',
        });
      }

      sessionManager.deleteSession(id);
      return reply.status(204).send();
    },
  );
}
