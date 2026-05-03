/**
 * Unit tests for Telemetry — Store, Routes, and LLM error fields.
 *
 * Covers:
 * - TelemetryBus is singleton (5.1.1) — re-verified here alongside store tests
 * - Table schema matches spec (5.3.2)
 * - Batch flush triggers at 50 events (5.3.4)
 * - LLM error fields recorded correctly (5.5.3)
 * - Traces endpoint returns correct summary shape (5.4.4)
 *
 * Requirements: 5.1.1, 5.3.2, 5.3.4, 5.4.4, 5.5.3
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { telemetryBus, type TelemetryEvent } from '../telemetry.bus.js';
import { TelemetryStore, initTelemetryStore } from '../telemetry.store.js';
import { telemetryRoutes } from '../telemetry.routes.js';
import { SQLiteStore } from '../../storage/sqlite.store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    traceId: 'trace-001',
    stage: 'gate',
    timestamp: Date.now(),
    durationMs: 42,
    status: 'success',
    ...overrides,
  };
}

/** Force the TelemetryStore to write pending events to SQLite. */
function forceStoreFlush(store: TelemetryStore): void {
  (store as any).flushToSQLite();
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

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

// =========================================================================
// 5.1.1 — TelemetryBus is singleton
// =========================================================================

describe('TelemetryBus singleton (Req 5.1.1)', () => {
  it('should return the same instance on repeated imports', async () => {
    const { telemetryBus: bus2 } = await import('../telemetry.bus.js');
    expect(bus2).toBe(telemetryBus);
  });
});

// =========================================================================
// 5.3.2 — Table schema matches spec
// =========================================================================

describe('telemetry_logs table schema (Req 5.3.2)', () => {
  it('should have all required columns with correct types', () => {
    const db = (sqliteStore as any)._db();
    const stmt = db.prepare("PRAGMA table_info('telemetry_logs')");

    const columns: Array<{ name: string; type: string; notnull: number }> = [];
    while (stmt.step()) {
      const colNames: string[] = stmt.getColumnNames();
      const values: unknown[] = stmt.get();
      const row: Record<string, unknown> = {};
      for (let i = 0; i < colNames.length; i++) {
        row[colNames[i]] = values[i];
      }
      columns.push({
        name: row['name'] as string,
        type: row['type'] as string,
        notnull: row['notnull'] as number,
      });
    }
    stmt.free();

    const colMap = new Map(columns.map((c) => [c.name, c]));

    // Required columns per design: id, trace_id, stage, timestamp,
    // duration_ms, status, metadata_json, created_at
    expect(colMap.has('id')).toBe(true);
    expect(colMap.get('id')!.type).toBe('INTEGER');

    expect(colMap.has('trace_id')).toBe(true);
    expect(colMap.get('trace_id')!.type).toBe('TEXT');
    expect(colMap.get('trace_id')!.notnull).toBe(1);

    expect(colMap.has('stage')).toBe(true);
    expect(colMap.get('stage')!.type).toBe('TEXT');
    expect(colMap.get('stage')!.notnull).toBe(1);

    expect(colMap.has('timestamp')).toBe(true);
    expect(colMap.get('timestamp')!.type).toBe('TEXT');
    expect(colMap.get('timestamp')!.notnull).toBe(1);

    expect(colMap.has('duration_ms')).toBe(true);
    expect(colMap.get('duration_ms')!.type).toBe('INTEGER');
    expect(colMap.get('duration_ms')!.notnull).toBe(1);

    expect(colMap.has('status')).toBe(true);
    expect(colMap.get('status')!.type).toBe('TEXT');
    expect(colMap.get('status')!.notnull).toBe(1);

    expect(colMap.has('metadata_json')).toBe(true);
    expect(colMap.get('metadata_json')!.type).toBe('TEXT');
    // metadata_json is nullable
    expect(colMap.get('metadata_json')!.notnull).toBe(0);

    expect(colMap.has('created_at')).toBe(true);
    expect(colMap.get('created_at')!.type).toBe('TEXT');
    expect(colMap.get('created_at')!.notnull).toBe(1);
  });

  it('should have indexes on trace_id, stage, and timestamp', () => {
    const db = (sqliteStore as any)._db();
    const stmt = db.prepare("PRAGMA index_list('telemetry_logs')");

    const indexNames: string[] = [];
    while (stmt.step()) {
      const colNames: string[] = stmt.getColumnNames();
      const values: unknown[] = stmt.get();
      const row: Record<string, unknown> = {};
      for (let i = 0; i < colNames.length; i++) {
        row[colNames[i]] = values[i];
      }
      indexNames.push(row['name'] as string);
    }
    stmt.free();

    expect(indexNames).toContain('idx_telemetry_trace');
    expect(indexNames).toContain('idx_telemetry_stage');
    expect(indexNames).toContain('idx_telemetry_timestamp');
  });

  it('should enforce status CHECK constraint (only success or error)', () => {
    const db = (sqliteStore as any)._db();

    // Valid statuses should work
    expect(() => {
      db.run(
        `INSERT INTO telemetry_logs (trace_id, stage, timestamp, duration_ms, status)
         VALUES ('t1', 'gate', '2025-01-01T00:00:00Z', 10, 'success')`,
      );
    }).not.toThrow();

    expect(() => {
      db.run(
        `INSERT INTO telemetry_logs (trace_id, stage, timestamp, duration_ms, status)
         VALUES ('t2', 'gate', '2025-01-01T00:00:00Z', 10, 'error')`,
      );
    }).not.toThrow();

    // Invalid status should throw
    expect(() => {
      db.run(
        `INSERT INTO telemetry_logs (trace_id, stage, timestamp, duration_ms, status)
         VALUES ('t3', 'gate', '2025-01-01T00:00:00Z', 10, 'warning')`,
      );
    }).toThrow();
  });
});

// =========================================================================
// 5.3.4 — Batch flush triggers at 50 events
// =========================================================================

describe('batch flush at 50 events (Req 5.3.4)', () => {
  it('should flush to SQLite when 50 events are received in a single bus flush', () => {
    // Emit 50 events to the bus.
    for (let i = 0; i < 50; i++) {
      telemetryBus.emitEvent(
        validEvent({ traceId: `batch-50-${i}`, stage: 'tool' }),
      );
    }

    // Flush the bus — this delivers all 50 events to the store's
    // onFlush handler, which should trigger an immediate SQLite write
    // because pendingEvents.length >= BATCH_SIZE (50).
    telemetryBus.flush();

    // Query the store — all 50 events should be persisted.
    const rows = telemetryStore.queryTelemetry({ stage: 'tool', limit: 100 });
    const batchRows = rows.filter((r) => r.trace_id.startsWith('batch-50-'));
    expect(batchRows).toHaveLength(50);
  });

  it('should not auto-flush to SQLite when fewer than 50 events are received', () => {
    // Emit 49 events.
    for (let i = 0; i < 49; i++) {
      telemetryBus.emitEvent(
        validEvent({ traceId: `batch-49-${i}`, stage: 'classifier' }),
      );
    }

    // Flush the bus — delivers 49 events to the store handler.
    // Since 49 < 50, the store should NOT auto-flush to SQLite.
    telemetryBus.flush();

    // The events are in the store's pendingEvents but not yet in SQLite.
    // Querying should return 0 rows (they haven't been written yet).
    const rows = telemetryStore.queryTelemetry({ stage: 'classifier', limit: 100 });
    const batchRows = rows.filter((r) => r.trace_id.startsWith('batch-49-'));
    expect(batchRows).toHaveLength(0);

    // Now force a flush — events should appear.
    forceStoreFlush(telemetryStore);
    const rowsAfter = telemetryStore.queryTelemetry({ stage: 'classifier', limit: 100 });
    const batchRowsAfter = rowsAfter.filter((r) => r.trace_id.startsWith('batch-49-'));
    expect(batchRowsAfter).toHaveLength(49);
  });
});

// =========================================================================
// 5.5.3 — LLM error fields recorded correctly
// =========================================================================

describe('LLM error fields recorded correctly (Req 5.5.3)', () => {
  it('should persist errorType and partialResponseLength in metadata', () => {
    const llmErrorEvent = validEvent({
      traceId: 'llm-error-trace',
      stage: 'llm',
      status: 'error',
      durationMs: 5000,
      metadata: {
        model: 'gpt-4',
        promptTokens: 150,
        completionTokens: 0,
        totalResponseMs: 5000,
        triggerStage: 'agent-loop',
        errorType: 'timeout',
        partialResponseLength: 42,
      },
    });

    telemetryBus.emitEvent(llmErrorEvent);
    telemetryBus.flush();
    forceStoreFlush(telemetryStore);

    const rows = telemetryStore.queryTelemetry({ traceId: 'llm-error-trace' });
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.status).toBe('error');
    expect(row.metadata_json).not.toBeNull();

    const metadata = JSON.parse(row.metadata_json!);
    expect(metadata.errorType).toBe('timeout');
    expect(metadata.partialResponseLength).toBe(42);
    expect(metadata.model).toBe('gpt-4');
    expect(metadata.triggerStage).toBe('agent-loop');
  });

  it('should persist LLM error event with no partial response', () => {
    const llmErrorEvent = validEvent({
      traceId: 'llm-error-no-partial',
      stage: 'llm',
      status: 'error',
      durationMs: 30000,
      metadata: {
        model: 'claude-3',
        promptTokens: 200,
        completionTokens: 0,
        totalResponseMs: 30000,
        triggerStage: 'classifier',
        errorType: 'rate_limit',
      },
    });

    telemetryBus.emitEvent(llmErrorEvent);
    telemetryBus.flush();
    forceStoreFlush(telemetryStore);

    const rows = telemetryStore.queryTelemetry({ traceId: 'llm-error-no-partial' });
    expect(rows).toHaveLength(1);

    const metadata = JSON.parse(rows[0].metadata_json!);
    expect(metadata.errorType).toBe('rate_limit');
    expect(metadata.partialResponseLength).toBeUndefined();
  });
});

// =========================================================================
// 5.4.4 — Traces endpoint returns correct summary shape
// =========================================================================

describe('GET /telemetry/traces returns correct summary shape (Req 5.4.4)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(telemetryRoutes(telemetryStore), { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should return an array of trace summaries with the correct fields', async () => {
    // Insert events for two traces.
    const events: TelemetryEvent[] = [
      validEvent({ traceId: 'trace-A', stage: 'gate', durationMs: 10, status: 'success' }),
      validEvent({ traceId: 'trace-A', stage: 'classifier', durationMs: 20, status: 'success' }),
      validEvent({ traceId: 'trace-A', stage: 'tool', durationMs: 100, status: 'error' }),
      validEvent({ traceId: 'trace-B', stage: 'gate', durationMs: 5, status: 'success' }),
      validEvent({ traceId: 'trace-B', stage: 'classifier', durationMs: 15, status: 'success' }),
    ];

    for (const evt of events) {
      telemetryBus.emitEvent(evt);
    }
    telemetryBus.flush();
    forceStoreFlush(telemetryStore);

    const res = await app.inject({
      method: 'GET',
      url: '/api/telemetry/traces',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);

    // Verify each trace summary has the required shape.
    for (const trace of body) {
      expect(trace).toHaveProperty('traceId');
      expect(trace).toHaveProperty('startTime');
      expect(trace).toHaveProperty('totalDurationMs');
      expect(trace).toHaveProperty('stageCount');
      expect(trace).toHaveProperty('errorCount');

      expect(typeof trace.traceId).toBe('string');
      expect(typeof trace.startTime).toBe('string');
      expect(typeof trace.totalDurationMs).toBe('number');
      expect(typeof trace.stageCount).toBe('number');
      expect(typeof trace.errorCount).toBe('number');
    }

    // Verify trace-A aggregation.
    const traceA = body.find((t: any) => t.traceId === 'trace-A');
    expect(traceA).toBeDefined();
    expect(traceA.stageCount).toBe(3);
    expect(traceA.errorCount).toBe(1);
    expect(traceA.totalDurationMs).toBe(130); // 10 + 20 + 100

    // Verify trace-B aggregation.
    const traceB = body.find((t: any) => t.traceId === 'trace-B');
    expect(traceB).toBeDefined();
    expect(traceB.stageCount).toBe(2);
    expect(traceB.errorCount).toBe(0);
    expect(traceB.totalDurationMs).toBe(20); // 5 + 15
  });

  it('should return 400 for invalid limit parameter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/telemetry/traces?limit=abc',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('code');
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('should return empty array when no traces exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/telemetry/traces',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});
