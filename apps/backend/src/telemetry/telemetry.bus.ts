/**
 * TelemetryBus — Singleton event bus for structured telemetry.
 *
 * Centralises pipeline telemetry events using a synchronous
 * EventEmitter so that emitting never adds latency to the
 * hot path.  Events are buffered internally and delivered to
 * registered flush handlers when `flush()` is called.
 *
 * @module telemetry/telemetry.bus
 */

import { EventEmitter } from 'node:events';

import { TelemetryValidationError } from '../errors/telemetry-errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelemetryEvent {
  traceId: string;
  stage: string;           // 'gate' | 'classifier' | 'extractor' | 'router' | 'tool' | 'llm'
  timestamp: number;       // Date.now()
  durationMs: number;
  status: 'success' | 'error';
  metadata?: Record<string, unknown>;
}

export interface LLMTelemetryMetadata {
  model: string;
  promptTokens: number;
  completionTokens: number;
  timeToFirstTokenMs?: number;
  totalResponseMs: number;
  triggerStage: string;
  errorType?: string;
  partialResponseLength?: number;
}

/** Callback invoked by `flush()` with the current event buffer. */
export type FlushHandler = (events: TelemetryEvent[]) => void;

// ---------------------------------------------------------------------------
// Required fields checked at emit-time
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: (keyof TelemetryEvent)[] = [
  'traceId',
  'stage',
  'timestamp',
  'durationMs',
  'status',
];

// ---------------------------------------------------------------------------
// TelemetryBusImpl
// ---------------------------------------------------------------------------

/**
 * Internal implementation of the TelemetryBus interface.
 *
 * Extends `EventEmitter` so that pipeline stages can subscribe to
 * the raw `'event'` channel if needed, but the primary consumption
 * path is via `onFlush` + `flush`.
 */
class TelemetryBusImpl extends EventEmitter {
  /** Buffered events waiting for the next flush. */
  private buffer: TelemetryEvent[] = [];

  /** Registered flush handlers. */
  private flushHandlers: FlushHandler[] = [];

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Validate and buffer a telemetry event.
   *
   * Emits a synchronous `'event'` on the underlying EventEmitter so
   * that any direct subscribers are notified immediately.
   *
   * @throws {TelemetryValidationError} when required fields are missing.
   */
  emitEvent(event: TelemetryEvent): void {
    this.validate(event);
    this.buffer.push(event);
    // Synchronous emit — no async overhead on the pipeline.
    super.emit('event', event);
  }

  /**
   * Register a handler that will receive the buffered events when
   * `flush()` is called.
   */
  onFlush(handler: FlushHandler): void {
    this.flushHandlers.push(handler);
  }

  /**
   * Deliver all buffered events to every registered flush handler,
   * then clear the buffer.
   *
   * Handlers receive a *copy* of the buffer so that mutations inside
   * a handler do not affect other handlers or the bus itself.
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    const snapshot = this.buffer;
    this.buffer = [];

    for (const handler of this.flushHandlers) {
      // Each handler gets its own copy so mutations in one handler
      // do not affect others.
      handler([...snapshot]);
    }
  }

  /**
   * Return the number of events currently buffered (useful for tests
   * and the 50-event batch threshold in the store layer).
   */
  get bufferedCount(): number {
    return this.buffer.length;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Ensure all required fields are present on the event.
   *
   * @throws {TelemetryValidationError} listing every missing field.
   */
  private validate(event: TelemetryEvent): void {
    const missing: string[] = [];

    for (const field of REQUIRED_FIELDS) {
      if (event[field] === undefined || event[field] === null) {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      throw new TelemetryValidationError(missing);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

/** Module-level singleton — import this from anywhere in the backend. */
export const telemetryBus = new TelemetryBusImpl();
