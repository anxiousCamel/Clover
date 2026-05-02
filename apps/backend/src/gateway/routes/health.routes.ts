/**
 * Health Check Routes — Fastify plugin that registers the system health
 * endpoint for diagnosing connectivity and configuration issues.
 *
 * Endpoints:
 * - `GET /health` — returns the status of all backend components
 *
 * Each component is reported as "healthy" or "unhealthy" with a
 * descriptive status message.
 *
 * @module gateway/routes/health.routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as ollamaClient from '../../ollama/ollama.client.js';
import * as openclaudeClient from '../../openclaude/openclaude.client.js';
import * as lancedbAdapter from '../../memory/lancedb.adapter.js';
import * as sessionManager from '../../orchestrator/session.manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComponentStatus {
  status: 'healthy' | 'unhealthy';
  message: string;
}

interface HealthResponse {
  openclaude: ComponentStatus;
  ollama: ComponentStatus;
  lancedb: ComponentStatus;
  sqlite: ComponentStatus;
}

// ---------------------------------------------------------------------------
// Health check helpers
// ---------------------------------------------------------------------------

/**
 * Check OpenClaude gRPC connectivity by verifying the client channel state.
 */
async function checkOpenClaude(): Promise<ComponentStatus> {
  try {
    const client = openclaudeClient.getClient();
    const channel = client.getChannel();
    const state = channel.getConnectivityState(true);
    // grpc connectivity states: 0=IDLE, 1=CONNECTING, 2=READY, 3=TRANSIENT_FAILURE, 4=SHUTDOWN
    if (state <= 2) {
      return { status: 'healthy', message: `gRPC channel state: ${state} (connected)` };
    }
    return { status: 'unhealthy', message: `gRPC channel state: ${state} (disconnected)` };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'unhealthy', message: `OpenClaude unreachable: ${message}` };
  }
}

/**
 * Check Ollama connectivity by attempting to list models.
 */
async function checkOllama(): Promise<ComponentStatus> {
  try {
    const models = await ollamaClient.listModels();
    return { status: 'healthy', message: `Ollama reachable, ${models.length} model(s) available` };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'unhealthy', message: `Ollama unreachable: ${message}` };
  }
}

/**
 * Check LanceDB accessibility by attempting a zero-result similarity search.
 */
async function checkLanceDB(): Promise<ComponentStatus> {
  try {
    // Perform a trivial search with a single-dimension vector to verify the DB is accessible
    await lancedbAdapter.similaritySearch([0], 1);
    return { status: 'healthy', message: 'LanceDB is accessible' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'unhealthy', message: `LanceDB error: ${message}` };
  }
}

/**
 * Check SQLite accessibility by attempting a session manager operation.
 */
async function checkSQLite(): Promise<ComponentStatus> {
  try {
    // Attempt to retrieve a non-existent session — if the store is
    // initialised and accessible this will return undefined without error.
    sessionManager.getSession('__health_check__');
    return { status: 'healthy', message: 'SQLite is accessible' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'unhealthy', message: `SQLite error: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin that registers the health check route.
 *
 * Registered with a `/api` prefix by the Gateway so that the full path
 * becomes `/api/health`.
 */
export default async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /health ─────────────────────────────────────────

  /**
   * Return the health status of all backend components.
   *
   * Checks OpenClaude (gRPC), Ollama (HTTP), LanceDB (embedded),
   * and SQLite (embedded) in parallel and returns their statuses.
   */
  fastify.get(
    '/health',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const [openclaude, ollama, lancedb, sqlite] = await Promise.all([
        checkOpenClaude(),
        checkOllama(),
        checkLanceDB(),
        checkSQLite(),
      ]);

      const health: HealthResponse = {
        openclaude,
        ollama,
        lancedb,
        sqlite,
      };

      // Return 200 even if some components are unhealthy — the caller
      // inspects individual statuses. Use 503 only if ALL are unhealthy.
      const allUnhealthy = [openclaude, ollama, lancedb, sqlite].every(
        (c) => c.status === 'unhealthy',
      );

      return reply.status(allUnhealthy ? 503 : 200).send(health);
    },
  );
}
