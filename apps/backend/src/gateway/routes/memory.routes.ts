/**
 * Memory & Search Routes — Fastify plugin that registers endpoints for
 * searching the vector memory and triggering async ingestion of files.
 *
 * Endpoints:
 * - `GET  /memory/search?q=&topK=&source=` → similarity search → Chunk[]
 * - `POST /memory/ingest`                  → async ingestion → 202 { taskId }
 *
 * The ingest endpoint is fire-and-forget: it kicks off
 * {@link memoryService.ingestDirectory} in the background and returns 202
 * immediately. A `memory:indexed` WebSocket event is emitted on completion.
 *
 * @module gateway/routes/memory.routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import * as memoryService from '../../memory/memory.service.js';
import { emit } from '../ws.server.js';

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

/** Query params for GET /memory/search */
interface MemorySearchQuery {
  q: string;
  topK?: number;
  source?: string;
}

/** Body for POST /memory/ingest */
interface IngestBody {
  path: string;
}

// ---------------------------------------------------------------------------
// JSON Schemas (Fastify validation)
// ---------------------------------------------------------------------------

const memorySearchSchema = {
  querystring: {
    type: 'object' as const,
    required: ['q'],
    properties: {
      q: { type: 'string' as const, minLength: 1 },
      topK: { type: 'number' as const, minimum: 1 },
      source: { type: 'string' as const },
    },
  },
};

const ingestSchema = {
  body: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: { type: 'string' as const, minLength: 1 },
    },
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin that registers memory search and ingestion routes.
 *
 * Registered with a `/api` prefix by the Gateway so that the full paths
 * become `/api/memory/search`, `/api/memory/ingest`, etc.
 */
export default async function memoryRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /memory/search ──────────────────────────────────

  /**
   * Perform a similarity search against the vector memory.
   *
   * Query: `?q=search+term&topK=5&source=vault`
   * Returns: `Chunk[]` sorted by relevance score descending.
   */
  fastify.get<{ Querystring: MemorySearchQuery }>(
    '/memory/search',
    { schema: memorySearchSchema },
    async (request: FastifyRequest<{ Querystring: MemorySearchQuery }>, reply: FastifyReply) => {
      const { q, topK, source } = request.query;

      try {
        const chunks = await memoryService.search(q, topK, source);
        return reply.send(chunks);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown search error';
        return reply.status(500).send({
          error: message,
          code: 'MEMORY_SEARCH_ERROR',
        });
      }
    },
  );

  // ── POST /memory/ingest ─────────────────────────────────

  /**
   * Trigger async ingestion of all markdown files in the given directory.
   *
   * The ingestion runs in the background — the HTTP response returns
   * immediately with 202 and a taskId for tracking. A `memory:indexed`
   * WebSocket event is emitted when ingestion completes.
   */
  fastify.post<{ Body: IngestBody }>(
    '/memory/ingest',
    { schema: ingestSchema },
    async (request: FastifyRequest<{ Body: IngestBody }>, reply: FastifyReply) => {
      const { path: dirPath } = request.body;
      const taskId = randomUUID();

      // Extract sessionId from header for WS event routing
      const sessionId =
        (request.headers['x-session-id'] as string | undefined) ?? 'default';

      // Fire-and-forget: kick off ingestion in the background
      memoryService
        .ingestDirectory(dirPath)
        .then(() => {
          emit(sessionId, 'memory:indexed', {
            taskId,
            source: dirPath,
            status: 'completed',
          });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Unknown ingestion error';
          emit(sessionId, 'memory:indexed', {
            taskId,
            source: dirPath,
            status: 'failed',
            error: message,
          });
        });

      return reply.status(202).send({ taskId });
    },
  );
}
