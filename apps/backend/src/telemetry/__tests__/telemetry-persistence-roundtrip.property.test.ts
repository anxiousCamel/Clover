/**
 * Property-Based Test — Property 19: Telemetry Event Persistence Round-Trip
 *
 * **Validates: Requirements 5.1.2, 5.3.1**
 *
 * For any valid `TelemetryEvent` emitted to the TelemetryBus, after a flush,
 * querying the `telemetry_logs` table by `traceId` and `stage` SHALL return
 * a row with matching `trace_id`, `stage`, `duration_ms`, `status`, and
 * `metadata_json` (deserialized) equal to the original event's fields.
 *
 * Generator strategy:
 *   - Generate random TelemetryEvent objects with arbitrary traceIds, stages,
 *     timestamps, durations, statuses, and optional metadata objects.
 *   - Emit each event to the TelemetryBus, flush, then query by traceId+stage
 *     and verify all persisted fields match the original event.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

import { telemetryBus, type TelemetryEvent } from '../telemetry.bus.js';
import { TelemetryStore, initTelemetryStore } from '../telemetry.store.js';
import { SQLiteStore } from '../../storage/sqlite.store.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generate a non-empty alphanumeric string suitable for traceId / stage. */
const identifierArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,50}$/);

/** Generate a valid status value. */
const statusArb = fc.constantFrom('success' as const, 'error' as const);

/** Generate a non-negative integer for durationMs. */
const durationArb = fc.integer({ min: 0, max: 1_000_000 });

/** Generate a timestamp (epoch ms) within a reasonable range. */
const timestampArb = fc.integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 });

/** Generate a simple metadata value (string, number, boolean, null). */
const metadataValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string({ minLength: 0, maxLength: 100 }),
  fc.integer({ min: -10_000, max: 10_000 }),
  fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
);

/** Generate an optional metadata object with 0–5 keys. */
const metadataArb: fc.Arbitrary<Record<string, unknown> | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.dictionary(
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,19}$/),
    metadataValueArb,
    { minKeys: 0, maxKeys: 5 },
  ),
);

/** Generate a valid TelemetryEvent. */
const telemetryEventArb: fc.Arbitrary<TelemetryEvent> = fc
  .tuple(identifierArb, identifierArb, timestampArb, durationArb, statusArb, metadataArb)
  .map(([traceId, stage, timestamp, durationMs, status, metadata]) => ({
    traceId,
    stage,
    timestamp,
    durationMs,
    status,
    metadata,
  }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Force the TelemetryStore to write all pending events to SQLite.
 *
 * The store's `flushToSQLite` is private, so we access it via a
 * type cast. This is acceptable in test code to avoid waiting for
 * the 1-second timer or emitting 50 events to hit the batch threshold.
 */
function forceStoreFlush(store: TelemetryStore): void {
  (store as any).flushToSQLite();
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('Property 19: Telemetry Event Persistence Round-Trip', () => {
  let sqliteStore: SQLiteStore;
  let telemetryStore: TelemetryStore;

  beforeEach(async () => {
    // Drain any leftover events / handlers from previous tests.
    telemetryBus.flush();
    telemetryBus.removeAllListeners();
    // Clear flush handlers by accessing the private array.
    // The singleton bus accumulates handlers across tests, so we
    // must reset them to avoid writing to closed SQLite stores.
    (telemetryBus as any).flushHandlers = [];

    // Create a fresh in-memory SQLite store for each test.
    sqliteStore = new SQLiteStore(':memory:');
    telemetryStore = await initTelemetryStore(sqliteStore);
  });

  afterEach(() => {
    telemetryStore.dispose();
    sqliteStore.close();
  });

  // -----------------------------------------------------------------------
  // Property: single event round-trip
  // -----------------------------------------------------------------------

  it('any valid TelemetryEvent emitted and flushed can be queried back with all fields matching', () => {
    fc.assert(
      fc.property(telemetryEventArb, (event) => {
        // Use a unique traceId per iteration to avoid cross-contamination.
        const uniqueEvent: TelemetryEvent = {
          ...event,
          traceId: `${event.traceId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        };

        // Emit the event to the bus.
        telemetryBus.emitEvent(uniqueEvent);

        // Flush the bus → moves events from bus buffer to store's pendingEvents.
        telemetryBus.flush();

        // Force the store to write pendingEvents to SQLite.
        forceStoreFlush(telemetryStore);

        // Query back by traceId and stage.
        const rows = telemetryStore.queryTelemetry({
          traceId: uniqueEvent.traceId,
          stage: uniqueEvent.stage,
        });

        // There should be at least one matching row.
        expect(rows.length).toBeGreaterThanOrEqual(1);

        const row = rows.find(
          (r) =>
            r.trace_id === uniqueEvent.traceId && r.stage === uniqueEvent.stage,
        );
        expect(row).toBeDefined();

        // Verify all persisted fields match the original event.
        expect(row!.trace_id).toBe(uniqueEvent.traceId);
        expect(row!.stage).toBe(uniqueEvent.stage);
        expect(row!.duration_ms).toBe(uniqueEvent.durationMs);
        expect(row!.status).toBe(uniqueEvent.status);

        // Verify timestamp was persisted as ISO string of the original epoch.
        expect(row!.timestamp).toBe(new Date(uniqueEvent.timestamp).toISOString());

        // Verify metadata round-trip.
        if (uniqueEvent.metadata !== undefined) {
          expect(row!.metadata_json).not.toBeNull();
          const parsedMetadata = JSON.parse(row!.metadata_json!);
          expect(parsedMetadata).toEqual(uniqueEvent.metadata);
        } else {
          expect(row!.metadata_json).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });

  // -----------------------------------------------------------------------
  // Property: batch of events round-trip
  // -----------------------------------------------------------------------

  it('a batch of TelemetryEvents emitted and flushed together all persist with correct fields', () => {
    fc.assert(
      fc.property(
        fc.array(telemetryEventArb, { minLength: 1, maxLength: 10 }),
        (events) => {
          // Make each event uniquely identifiable.
          const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          const uniqueEvents = events.map((e, i) => ({
            ...e,
            traceId: `${e.traceId}-batch-${batchId}-${i}`,
          }));

          // Emit all events.
          for (const evt of uniqueEvents) {
            telemetryBus.emitEvent(evt);
          }

          // Flush bus → store pendingEvents, then force store → SQLite.
          telemetryBus.flush();
          forceStoreFlush(telemetryStore);

          // Verify each event was persisted correctly.
          for (const evt of uniqueEvents) {
            const rows = telemetryStore.queryTelemetry({
              traceId: evt.traceId,
              stage: evt.stage,
            });

            expect(rows.length).toBeGreaterThanOrEqual(1);

            const row = rows.find(
              (r) => r.trace_id === evt.traceId && r.stage === evt.stage,
            );
            expect(row).toBeDefined();
            expect(row!.trace_id).toBe(evt.traceId);
            expect(row!.stage).toBe(evt.stage);
            expect(row!.duration_ms).toBe(evt.durationMs);
            expect(row!.status).toBe(evt.status);
            expect(row!.timestamp).toBe(new Date(evt.timestamp).toISOString());

            if (evt.metadata !== undefined) {
              expect(row!.metadata_json).not.toBeNull();
              expect(JSON.parse(row!.metadata_json!)).toEqual(evt.metadata);
            } else {
              expect(row!.metadata_json).toBeNull();
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
