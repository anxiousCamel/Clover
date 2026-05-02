/**
 * Planner Routes — Fastify plugin that registers the planning generation
 * endpoint.
 *
 * Endpoints:
 * - `POST /planner/generate` — kick off the 4-phase planning pipeline (202)
 *
 * The generate handler is intentionally fire-and-forget: it starts
 * {@link plannerService.generate} in the background and returns 202
 * immediately with a `taskId` so the UI can track progress via
 * `planner:progress` and `planner:done` WebSocket events.
 *
 * @module gateway/routes/planner.routes
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as plannerService from '../../planner/planner.service.js';
import { emit } from '../ws.server.js';

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

/** Body for POST /planner/generate */
interface GenerateBody {
  goal: string;
  workspacePath: string;
}

// ---------------------------------------------------------------------------
// JSON Schemas (Fastify validation)
// ---------------------------------------------------------------------------

const generateSchema = {
  body: {
    type: 'object' as const,
    required: ['goal', 'workspacePath'],
    properties: {
      goal: { type: 'string' as const, minLength: 1 },
      workspacePath: { type: 'string' as const, minLength: 1 },
    },
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin that registers planner routes.
 *
 * Registered with a `/api` prefix by the Gateway so that the full path
 * becomes `/api/planner/generate`.
 */
export default async function plannerRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /planner/generate ──────────────────────────────

  /**
   * Accept a planning goal and kick off the 4-phase pipeline.
   *
   * The planner service runs asynchronously in the background — progress
   * and completion events are delivered via WebSocket. The HTTP response
   * returns immediately with 202 and a `taskId` so the client is never
   * blocked.
   */
  fastify.post<{ Body: GenerateBody }>(
    '/planner/generate',
    { schema: generateSchema },
    async (request: FastifyRequest<{ Body: GenerateBody }>, reply: FastifyReply) => {
      const { goal, workspacePath } = request.body;
      const taskId = randomUUID();

      // Fire-and-forget: kick off planner pipeline in the background
      plannerService
        .generate(goal, workspacePath, (type: string, data: unknown) =>
          emit(taskId, type, data),
        )
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Unknown error';
          emit(taskId, 'planner:error', { taskId, error: message });
        });

      return reply.status(202).send({ taskId });
    },
  );
}
