/**
 * Models & Config Routes — Fastify plugin that registers endpoints for
 * listing available Ollama models and updating the active model selection.
 *
 * Endpoints:
 * - `GET  /models`        — list all models available in Ollama
 * - `PATCH /config/model`  — update the active model for a session
 *
 * @module gateway/routes/models.routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as ollamaClient from '../../ollama/ollama.client.js';
import * as sessionManager from '../../orchestrator/session.manager.js';

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

/** Body for PATCH /config/model */
interface UpdateModelBody {
  sessionId: string;
  model: string;
}

// ---------------------------------------------------------------------------
// JSON Schemas (Fastify validation)
// ---------------------------------------------------------------------------

const updateModelSchema = {
  body: {
    type: 'object' as const,
    required: ['sessionId', 'model'],
    properties: {
      sessionId: { type: 'string' as const, minLength: 1 },
      model: { type: 'string' as const, minLength: 1 },
    },
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin that registers model listing and selection routes.
 *
 * Registered with a `/api` prefix by the Gateway so that the full paths
 * become `/api/models` and `/api/config/model`.
 */
export default async function modelsRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /models ─────────────────────────────────────────

  /**
   * List all models currently available in Ollama.
   *
   * Calls the Ollama `/api/tags` endpoint and returns the model list.
   */
  fastify.get(
    '/models',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const models = await ollamaClient.listModels();
        // Filter out embedding-only models that don't support chat
        const EMBED_PATTERNS = /\b(embed|nomic-embed|bge-|e5-|gte-|all-minilm)\b/i;
        const chatModels = models.filter(m => !EMBED_PATTERNS.test(m.name));
        return reply.send(chatModels);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to list models';
        return reply.status(502).send({
          error: message,
          code: 'OLLAMA_UNAVAILABLE',
        });
      }
    },
  );

  // ── PATCH /config/model ─────────────────────────────────

  /**
   * Update the active model for a session.
   *
   * Persists the model selection in the session store so that it
   * survives page reloads.
   */
  fastify.patch<{ Body: UpdateModelBody }>(
    '/config/model',
    { schema: updateModelSchema },
    async (request: FastifyRequest<{ Body: UpdateModelBody }>, reply: FastifyReply) => {
      const { sessionId, model } = request.body;

      // Verify the session exists
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return reply.status(404).send({
          error: 'Session not found',
          code: 'SESSION_NOT_FOUND',
        });
      }

      sessionManager.setModel(sessionId, model);

      return reply.status(200).send({ updated: true, model });
    },
  );
}
