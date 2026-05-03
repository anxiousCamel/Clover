/**
 * Property-Based Test — Property 21: Telemetry Query Filter Correctness
 *
 * **Validates: Requirements 5.4.2, 5.4.3**
 *
 * For any combination of query filters (`traceId`, `stage`, `status`,
 * `fromDate`, `toDate`), every row returned by the telemetry query SHALL
 * match ALL specified filters, and results SHALL be ordered by timestamp
 * descending.
 *
 * Generator strategy:
 *   - Generate a batch of telemetry events with varied traceIds, stages,
 *     statuses, and timestamps.
 *   - Insert them into the store.
 *   - Generate a random subset of filters drawn from the inserted data.
 *   - Query with those filters and verify:
 *     (a) every returned row satisfies ALL active filters
 *     (b) rows are ordered by timestamp descending
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

import { telemetryBus, type TelemetryEvent } from '../telemetry.bus.js';
import { TelemetryStore, initTelemetryStore } from '../telemetry.store.js';
import { SQLiteStore } from '../../storage/sqlite.store.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Small pool of trace IDs so filters have a reasonable chance of matching. */
const traceIdPoolArb = fc.constantFrom(
  'trace-alpha',
  'trace-beta',
  'trace-gamma',
  'trace-delta',
  'trace-epsilon',
);

/** Small pool of stages. */
const stagePoolArb = fc.constantFrom(
  'gate',
  'classifier',
  'extractor',
  'router',
  'tool',
  'llm',
);

/** Valid status values. */
const statusArb = fc.constantFrom('success' as const, 'error' as const);

/** Non-negative duration. */
const durationArb = fc.integer({ min: 0, max: 100_000 });

/**
 * Generate a timestamp within a controlled range so that fromDate/toDate
 * filters are meaningful. We use a 30-day window.
 */
const BASE_TS = new Date('2025-01-01T00:00:00.000Z').getTime();
const RANGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const timestampArb = fc.integer({ min: BASE_TS, max: BASE_TS + RANGE_MS });

/** Generate a single TelemetryEvent from the constrained pools. */
const pooledEventArb: fc.Arbitrary<TelemetryEvent> = fc
  .tuple(traceIdPoolArb, stagePoolArb, timestampArb, durationArb, statusArb)
  .map(([traceId, stage, timestamp, durationMs, status]) => ({
    traceId,
    stage,
    timestamp,
    durationMs,
    status,
  }));

/** Generate a batch of 5–30 events to populate the store. */
const eventBatchArb = fc.array(pooledEventArb, { minLength: 5, maxLength: 30 });

/**
 * Generate a random filter combination.
 *
 * Each filter field is independently present or absent. When present,
 * the value is drawn from the same pools used for event generation so
 * that matches are likely (but not guaranteed — that's fine, we verify
 * correctness either way).
 */
const filtersArb = fc.record(
  {
    traceId: fc.option(traceIdPoolArb, { nil: undefined }),
    stage: fc.option(stagePoolArb, { nil: undefined }),
    status: fc.option(statusArb, { nil: undefined }),
    fromDate: fc.option(timestampArb.map((ts) => new Date(ts).toISOString()), {
      nil: undefined,
    }),
    toDate: fc.option(timestampArb.map((ts) => new Date(ts).toISOString()), {
      nil: undefined,
    }),
  },
  { requiredKeys: [] },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Force the TelemetryStore to write pending events to SQLite. */
function forceStoreFlush(store: TelemetryStore): void {
  (store as any).flushToSQLite();
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('Property 21: Telemetry Query Filter Correctness', () => {
  let sqliteStore: SQLiteStore;
  let telemetryStore: TelemetryStore;

  beforeEach(async () => {
    // Reset the singleton bus between tests.
    telemetryBus.flush();
    telemetryBus.removeAllListeners();
    (telemetryBus as any).flushHandlers = [];

    sqliteStore = new SQLiteStore(':memory:');
    telemetryStore = await initTelemetryStore(sqliteStore);
  });

  afterEach(() => {
    telemetryStore.dispose();
    sqliteStore.close();
  });

  it('every returned row matches ALL specified filters and results are ordered by timestamp desc', () => {
    fc.assert(
      fc.property(eventBatchArb, filtersArb, (events, filters) => {
        // ── Insert events ──────────────────────────────────────
        for (const evt of events) {
          telemetryBus.emitEvent(evt);
        }
        telemetryBus.flush();
        forceStoreFlush(telemetryStore);

        // ── Build query filters (strip undefined values) ───────
        const queryFilters: Record<string, string | number | undefined> = {};
        if (filters.traceId !== undefined) queryFilters.traceId = filters.traceId;
        if (filters.stage !== undefined) queryFilters.stage = filters.stage;
        if (filters.status !== undefined) queryFilters.status = filters.status;
        if (filters.fromDate !== undefined) queryFilters.fromDate = filters.fromDate;
        if (filters.toDate !== undefined) queryFilters.toDate = filters.toDate;

        // ── Query ──────────────────────────────────────────────
        const rows = telemetryStore.queryTelemetry(queryFilters as any);

        // ── Verify: every row matches ALL active filters ───────
        for (const row of rows) {
          if (filters.traceId !== undefined) {
            expect(row.trace_id).toBe(filters.traceId);
          }
          if (filters.stage !== undefined) {
            expect(row.stage).toBe(filters.stage);
          }
          if (filters.status !== undefined) {
            expect(row.status).toBe(filters.status);
          }
          if (filters.fromDate !== undefined) {
            expect(row.timestamp >= filters.fromDate).toBe(true);
          }
          if (filters.toDate !== undefined) {
            expect(row.timestamp <= filters.toDate).toBe(true);
          }
        }

        // ── Verify: results ordered by timestamp descending ────
        for (let i = 1; i < rows.length; i++) {
          expect(rows[i - 1].timestamp >= rows[i].timestamp).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
