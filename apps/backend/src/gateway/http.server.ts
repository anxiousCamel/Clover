/**
 * Gateway HTTP Server — Fastify-based HTTP server for the Clover backend.
 *
 * Initialises a Fastify instance with CORS restricted to localhost,
 * schema-based request validation, and a global error handler that
 * normalises all errors to `{ error: string, code: string }`.
 *
 * Route files are registered via {@link registerRoutes} once they are
 * created in subsequent tasks (13.3–13.7).
 *
 * @module gateway/http.server
 */

import Fastify, {
  type FastifyError,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import cors from '@fastify/cors';
import { config } from '../config/config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Standardised error response returned by all endpoints. */
export interface ErrorResponse {
  error: string;
  code: string;
}

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

/**
 * The shared Fastify instance.
 *
 * Exported so that route modules and the WebSocket server can register
 * plugins and routes against it.
 */
export const app = Fastify({
  logger: true,
});

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

/**
 * Register CORS plugin restricted to the configured localhost origin.
 *
 * The origin defaults to `http://localhost:1420` (Tauri dev server) and
 * can be overridden via `CLOVER_GATEWAY_CORSORIGIN`.
 */
await app.register(cors, {
  origin: config.gateway.corsOrigin,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

/*
 * Fastify validates all HTTP request bodies automatically when a route
 * defines a JSON Schema via `schema.body`. The built-in Ajv compiler
 * handles this out of the box — no custom validator compiler is needed.
 *
 * Routes created in tasks 13.3–13.7 will define their schemas inline
 * and Fastify will enforce them before the handler runs.
 */

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

/**
 * Normalise every error to `{ error: string, code: string }` so that
 * the UI always receives a predictable shape.
 *
 * - Fastify validation errors → code `VALIDATION_ERROR`
 * - Known Fastify errors      → code from `error.code`
 * - Unknown errors             → code `INTERNAL_ERROR`
 */
app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
  const statusCode = error.statusCode ?? 500;

  // Validation errors produced by Ajv / Fastify schema validation
  if (error.validation) {
    const message = error.validation
      .map((v: { message?: string }) => v.message ?? 'invalid value')
      .join('; ');

    void reply.status(400).send({
      error: message,
      code: 'VALIDATION_ERROR',
    } satisfies ErrorResponse);
    return;
  }

  // Any other Fastify error with a code
  const code = error.code ?? 'INTERNAL_ERROR';

  void reply.status(statusCode).send({
    error: error.message,
    code,
  } satisfies ErrorResponse);
});

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------

/**
 * Return a consistent error shape for unknown routes.
 */
app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
  void reply.status(404).send({
    error: 'Route not found',
    code: 'NOT_FOUND',
  } satisfies ErrorResponse);
});

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Register all route modules.
 *
 * Route files will be created in tasks 13.3–13.7. Each route module
 * exports a Fastify plugin that is registered here.
 *
 * Uncomment the imports below as route files are implemented.
 */
export async function registerRoutes(): Promise<void> {
  const { default: chatRoutes } = await import('./routes/chat.routes.js');
  const { default: filesRoutes } = await import('./routes/files.routes.js');
  const { default: memoryRoutes } = await import('./routes/memory.routes.js');
  const { default: terminalRoutes } = await import('./routes/terminal.routes.js');
  const { default: modelsRoutes } = await import('./routes/models.routes.js');
  const { default: healthRoutes } = await import('./routes/health.routes.js');
  const { default: plannerRoutes } = await import('./routes/planner.routes.js');

  await app.register(chatRoutes, { prefix: '/api' });
  await app.register(filesRoutes, { prefix: '/api' });
  await app.register(memoryRoutes, { prefix: '/api' });
  await app.register(terminalRoutes, { prefix: '/api' });
  await app.register(modelsRoutes, { prefix: '/api' });
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(plannerRoutes, { prefix: '/api' });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the Fastify HTTP server on the configured host and port.
 *
 * Registers all routes before listening. Logs the bound address on
 * success.
 */
export async function start(): Promise<void> {
  await registerRoutes();

  const { port, host } = config.gateway;

  await app.listen({ port, host });
  app.log.info(`Gateway listening on http://${host}:${port}`);
}

/**
 * Gracefully shut down the Fastify server.
 *
 * Closes all active connections and releases resources.
 */
export async function stop(): Promise<void> {
  await app.close();
}
