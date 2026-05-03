/**
 * TelemetryStore — Telemetry persistence layer backed by SQLite (sql.js).
 *
 * Registers as a flush handler on the TelemetryBus and writes events
 * to the `telemetry_logs` table using batched async writes.
 *
 * Batching strategy: flush every 1 second OR every 50 events,
 * whichever comes first.  On SQLite write failure the events are
 * kept in the retry buffer and re-attempted on the next flush cycle.
 *
 * @module telemetry/telemetry.store
 */

import type { SQLiteStore } from '../storage/sqlite.store.js';
import { telemetryBus, type TelemetryEvent } from './telemetry.bus.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum events buffered before forcing a flush to SQLite. */
const BATCH_SIZE = 50;

/** Interval (ms) between automatic flush cycles. */
const FLUSH_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelemetryLogRow {
  id: number;
  trace_id: string;
  stage: string;
  timestamp: string;
  duration_ms: number;
  status: string;
  metadata_json: string | null;
  created_at: string;
}

export interface TelemetryQueryFilters {
  traceId?: string;
  stage?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface TraceSummaryRow {
  traceId: string;
  startTime: string;
  totalDurationMs: number;
  stageCount: number;
  errorCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert sql.js row arrays into objects keyed by column name. */
function rowToObject(columns: string[], values: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    obj[columns[i]] = values[i];
  }
  return obj;
}


// ---------------------------------------------------------------------------
// TelemetryStore
// ---------------------------------------------------------------------------

export class TelemetryStore {
  private sqliteStore: SQLiteStore;

  /** Events waiting to be written to SQLite. */
  private pendingEvents: TelemetryEvent[] = [];

  /** Events that failed to write and are queued for retry. */
  private retryBuffer: TelemetryEvent[] = [];

  /** Periodic flush timer handle. */
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(sqliteStore: SQLiteStore) {
    this.sqliteStore = sqliteStore;
  }

  // -----------------------------------------------------------------------
  // Initialisation
  // -----------------------------------------------------------------------

  /**
   * Create the `telemetry_logs` table + indexes and wire up the
   * TelemetryBus flush handler and periodic timer.
   */
  async init(): Promise<void> {
    await this.sqliteStore.ensureReady();
    this.createSchema();
    this.registerBusHandler();
    this.startFlushTimer();
  }

  // -----------------------------------------------------------------------
  // Schema
  // -----------------------------------------------------------------------

  private createSchema(): void {
    // Access the underlying sql.js Database via the public helper.
    // We run raw SQL through the store's exec helper exposed below.
    this.execSQL(`
      CREATE TABLE IF NOT EXISTS telemetry_logs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id      TEXT NOT NULL,
        stage         TEXT NOT NULL,
        timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
        duration_ms   INTEGER NOT NULL,
        status        TEXT NOT NULL CHECK(status IN ('success', 'error')),
        metadata_json TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    this.execSQL(
      `CREATE INDEX IF NOT EXISTS idx_telemetry_trace ON telemetry_logs(trace_id);`,
    );
    this.execSQL(
      `CREATE INDEX IF NOT EXISTS idx_telemetry_stage ON telemetry_logs(stage);`,
    );
    this.execSQL(
      `CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry_logs(timestamp);`,
    );
  }

  // -----------------------------------------------------------------------
  // Bus integration
  // -----------------------------------------------------------------------

  /**
   * Register as a flush handler on the TelemetryBus.
   *
   * The bus calls our handler with a snapshot of buffered events
   * whenever `telemetryBus.flush()` is invoked.  We add them to
   * our own pending queue and trigger a write when the batch
   * threshold is reached.
   */
  private registerBusHandler(): void {
    telemetryBus.onFlush((events: TelemetryEvent[]) => {
      this.pendingEvents.push(...events);

      // If we've hit the batch size, flush immediately.
      if (this.pendingEvents.length >= BATCH_SIZE) {
        this.flushToSQLite();
      }
    });
  }

  /**
   * Start the periodic flush timer (1 second interval).
   * Ensures events are persisted even when the batch threshold
   * is not reached.
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      // First, flush the bus so any buffered events reach us.
      telemetryBus.flush();
      // Then persist whatever we have.
      this.flushToSQLite();
    }, FLUSH_INTERVAL_MS);

    // Allow the Node process to exit even if the timer is active.
    if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
      this.flushTimer.unref();
    }
  }

  // -----------------------------------------------------------------------
  // SQLite writes
  // -----------------------------------------------------------------------

  /**
   * Write all pending + retry events to the `telemetry_logs` table.
   *
   * On failure the events are moved back into the retry buffer so
   * they can be re-attempted on the next flush cycle.
   */
  private flushToSQLite(): void {
    // Merge retry buffer with pending events.
    const toWrite = [...this.retryBuffer, ...this.pendingEvents];
    this.retryBuffer = [];
    this.pendingEvents = [];

    if (toWrite.length === 0) return;

    try {
      for (const event of toWrite) {
        this.execSQL(
          `INSERT INTO telemetry_logs (trace_id, stage, timestamp, duration_ms, status, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            event.traceId,
            event.stage,
            new Date(event.timestamp).toISOString(),
            event.durationMs,
            event.status,
            event.metadata ? JSON.stringify(event.metadata) : null,
          ],
        );
      }
      this.persistDB();
    } catch (err) {
      // On write failure: log error and buffer for retry.
      console.error('[TelemetryStore] SQLite write failed, buffering for retry:', err);
      this.retryBuffer.push(...toWrite);
    }
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Query telemetry logs with optional filters.
   *
   * Results are ordered by timestamp descending.
   */
  queryTelemetry(filters: TelemetryQueryFilters = {}): TelemetryLogRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.traceId) {
      conditions.push('trace_id = ?');
      params.push(filters.traceId);
    }
    if (filters.stage) {
      conditions.push('stage = ?');
      params.push(filters.stage);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.fromDate) {
      conditions.push('timestamp >= ?');
      params.push(filters.fromDate);
    }
    if (filters.toDate) {
      conditions.push('timestamp <= ?');
      params.push(filters.toDate);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 100;

    const sql = `
      SELECT id, trace_id, stage, timestamp, duration_ms, status, metadata_json, created_at
      FROM telemetry_logs
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ?
    `;

    return this.querySQL(sql, [...params, limit]);
  }

  /**
   * Query a summary of recent traces.
   *
   * Groups telemetry logs by `trace_id` and returns:
   * - `traceId` — the trace identifier
   * - `startTime` — earliest timestamp in the trace
   * - `totalDurationMs` — sum of all stage durations in the trace
   * - `stageCount` — number of telemetry events in the trace
   * - `errorCount` — number of events with status = 'error'
   *
   * Results are ordered by start time descending.
   */
  queryTraces(limit: number = 50): TraceSummaryRow[] {
    const sql = `
      SELECT
        trace_id,
        MIN(timestamp) AS start_time,
        SUM(duration_ms) AS total_duration_ms,
        COUNT(*) AS stage_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count
      FROM telemetry_logs
      GROUP BY trace_id
      ORDER BY start_time DESC
      LIMIT ?
    `;

    const db = (this.sqliteStore as any)._db();
    const stmt = db.prepare(sql);
    stmt.bind([limit]);

    const rows: TraceSummaryRow[] = [];
    while (stmt.step()) {
      const columns: string[] = stmt.getColumnNames();
      const values: unknown[] = stmt.get();
      const obj = rowToObject(columns, values);
      rows.push({
        traceId: obj['trace_id'] as string,
        startTime: obj['start_time'] as string,
        totalDurationMs: obj['total_duration_ms'] as number,
        stageCount: obj['stage_count'] as number,
        errorCount: obj['error_count'] as number,
      });
    }
    stmt.free();
    return rows;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Stop the periodic flush timer and persist any remaining events.
   */
  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Final flush of any remaining events.
    telemetryBus.flush();
    this.flushToSQLite();
  }

  // -----------------------------------------------------------------------
  // Low-level SQL helpers
  // -----------------------------------------------------------------------

  /**
   * Execute a SQL statement (DDL / DML) against the underlying
   * SQLiteStore's database.
   *
   * We access the db through the store's public `execRaw` method
   * which we add below via the init function, or fall back to
   * using the store's internal db reference.
   */
  private execSQL(sql: string, params?: unknown[]): void {
    // Use the raw db accessor exposed by initTelemetryStore.
    (this.sqliteStore as any)._db().run(sql, params);
  }

  /**
   * Run a SELECT query and return typed rows.
   */
  private querySQL(sql: string, params: unknown[]): TelemetryLogRow[] {
    const db = (this.sqliteStore as any)._db();
    const stmt = db.prepare(sql);
    stmt.bind(params);

    const rows: TelemetryLogRow[] = [];
    while (stmt.step()) {
      const columns: string[] = stmt.getColumnNames();
      const values: unknown[] = stmt.get();
      rows.push(rowToObject(columns, values) as unknown as TelemetryLogRow);
    }
    stmt.free();
    return rows;
  }

  /**
   * Persist the in-memory SQLite database to disk.
   */
  private persistDB(): void {
    // Trigger the SQLiteStore's persist mechanism by calling a
    // no-op write that invokes its internal persist().
    // We use the private persist method via the accessor.
    (this.sqliteStore as any)._persist();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create and initialise a TelemetryStore.
 *
 * Patches the SQLiteStore with thin accessors so the telemetry layer
 * can run raw SQL without modifying the SQLiteStore class itself.
 *
 * @param sqliteStore — The application's existing SQLiteStore instance.
 * @returns The initialised TelemetryStore.
 */
export async function initTelemetryStore(
  sqliteStore: SQLiteStore,
): Promise<TelemetryStore> {
  // Ensure the SQLiteStore is ready (DB loaded / schema created).
  await sqliteStore.ensureReady();

  // Expose thin accessors for the telemetry layer.
  // These are intentionally minimal — they only forward to the
  // private `db` and `persist` members of SQLiteStore.
  if (!(sqliteStore as any)._db) {
    (sqliteStore as any)._db = () => (sqliteStore as any).db;
  }
  if (!(sqliteStore as any)._persist) {
    (sqliteStore as any)._persist = () => (sqliteStore as any).persist();
  }

  const store = new TelemetryStore(sqliteStore);
  await store.init();
  return store;
}

// ---------------------------------------------------------------------------
// Convenience query export
// ---------------------------------------------------------------------------

/**
 * Standalone query function for use by the REST API layer.
 *
 * Requires a reference to an initialised TelemetryStore.
 */
export function queryTelemetry(
  store: TelemetryStore,
  filters: TelemetryQueryFilters = {},
): TelemetryLogRow[] {
  return store.queryTelemetry(filters);
}
