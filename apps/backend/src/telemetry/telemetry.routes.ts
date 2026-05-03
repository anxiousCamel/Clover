/**
 * Telemetry REST API Routes — Fastify plugin that registers endpoints
 * for querying telemetry data.
 *
 * Endpoints:
 * - `GET /telemetry`        — query telemetry events with filters
 * - `GET /telemetry/traces` — summary of recent traces
 *
 * The store instance is injected via the plugin factory function so
 * that the routes can be tested independently.
 *
 * @module telemetry/telemetry.routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { TelemetryStore, TelemetryQueryFilters } from './telemetry.store.js';

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

/** Query params for GET /telemetry */
interface TelemetryQuery {
  traceId?: string;
  stage?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  limit?: string;
}

/** Query params for GET /telemetry/traces */
interface TracesQuery {
  limit?: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set(['success', 'error']);

/**
 * Parse and validate the `limit` query parameter.
 *
 * Returns the parsed integer on success, or a descriptive error string
 * on failure.
 */
function parseLimit(raw: string | undefined, defaultValue: number): number | string {
  if (raw === undefined || raw === '') return defaultValue;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return `"limit" must be a positive integer, got "${raw}"`;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create a Fastify plugin that registers telemetry query routes.
 *
 * The `TelemetryStore` is injected via the factory so that the HTTP
 * layer is decoupled from the persistence layer.
 *
 * @param store — An initialised TelemetryStore instance.
 * @returns A Fastify plugin function suitable for `app.register()`.
 */
export function telemetryRoutes(store: TelemetryStore) {
  return async function plugin(fastify: FastifyInstance): Promise<void> {
    // ── GET /telemetry ──────────────────────────────────────

    /**
     * Query telemetry events with optional filters.
     *
     * Query params:
     * - `traceId`  — filter by trace identifier
     * - `stage`    — filter by pipeline stage
     * - `status`   — filter by status (`success` | `error`)
     * - `fromDate` — inclusive lower bound (ISO 8601)
     * - `toDate`   — inclusive upper bound (ISO 8601)
     * - `limit`    — max rows returned (default 100, must be positive integer)
     *
     * Returns: `TelemetryLogRow[]` ordered by timestamp descending.
     */
    fastify.get<{ Querystring: TelemetryQuery }>(
      '/telemetry',
      async (
        request: FastifyRequest<{ Querystring: TelemetryQuery }>,
        reply: FastifyReply,
      ) => {
        const { traceId, stage, status, fromDate, toDate, limit: rawLimit } = request.query;

        // Validate status
        if (status !== undefined && status !== '' && !VALID_STATUSES.has(status)) {
          return reply.status(400).send({
            error: `"status" must be "success" or "error", got "${status}"`,
            code: 'VALIDATION_ERROR',
          });
        }

        // Validate limit
        const limitResult = parseLimit(rawLimit, 100);
        if (typeof limitResult === 'string') {
          return reply.status(400).send({
            error: limitResult,
            code: 'VALIDATION_ERROR',
          });
        }

        const filters: TelemetryQueryFilters = {
          ...(traceId ? { traceId } : {}),
          ...(stage ? { stage } : {}),
          ...(status ? { status } : {}),
          ...(fromDate ? { fromDate } : {}),
          ...(toDate ? { toDate } : {}),
          limit: limitResult,
        };

        try {
          const rows = store.queryTelemetry(filters);
          return reply.send(rows);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown telemetry query error';
          return reply.status(500).send({
            error: message,
            code: 'TELEMETRY_QUERY_ERROR',
          });
        }
      },
    );

    // ── GET /telemetry/traces ───────────────────────────────

    /**
     * Return a summary of recent traces.
     *
     * Each entry contains:
     * - `traceId`         — the trace identifier
     * - `startTime`       — earliest event timestamp in the trace
     * - `totalDurationMs` — sum of all stage durations
     * - `stageCount`      — number of telemetry events
     * - `errorCount`      — number of events with status = 'error'
     *
     * Query params:
     * - `limit` — max traces returned (default 50, must be positive integer)
     */
    fastify.get<{ Querystring: TracesQuery }>(
      '/telemetry/traces',
      async (
        request: FastifyRequest<{ Querystring: TracesQuery }>,
        reply: FastifyReply,
      ) => {
        const { limit: rawLimit } = request.query;

        // Validate limit
        const limitResult = parseLimit(rawLimit, 50);
        if (typeof limitResult === 'string') {
          return reply.status(400).send({
            error: limitResult,
            code: 'VALIDATION_ERROR',
          });
        }

        try {
          const traces = store.queryTraces(limitResult);
          return reply.send(traces);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown telemetry query error';
          return reply.status(500).send({
            error: message,
            code: 'TELEMETRY_QUERY_ERROR',
          });
        }
      },
    );
  };
}

export default telemetryRoutes;
