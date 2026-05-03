/**
 * Unit tests for TelemetryBus singleton.
 *
 * Covers: singleton guarantee, event validation, buffering,
 * flush delivery, and synchronous emit behaviour.
 *
 * Requirements: 5.1.1, 5.1.2, 5.1.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TelemetryValidationError } from '../../errors/telemetry-errors.js';
import {
  telemetryBus,
  type TelemetryEvent,
} from '../telemetry.bus.js';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TelemetryBus', () => {
  beforeEach(() => {
    // Drain any leftover events from previous tests.
    telemetryBus.flush();
    telemetryBus.removeAllListeners();
  });

  // ========================================================================
  // Singleton (Req 5.1.1)
  // ========================================================================

  describe('singleton', () => {
    it('should export the same instance on repeated imports', async () => {
      const { telemetryBus: bus2 } = await import('../telemetry.bus.js');
      expect(bus2).toBe(telemetryBus);
    });
  });

  // ========================================================================
  // Validation (Req 5.1.2)
  // ========================================================================

  describe('validation', () => {
    it('should reject an event missing traceId', () => {
      const event = validEvent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (event as any).traceId;

      expect(() => telemetryBus.emitEvent(event)).toThrow(
        TelemetryValidationError,
      );
    });

    it('should reject an event missing stage', () => {
      const event = validEvent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (event as any).stage;

      expect(() => telemetryBus.emitEvent(event)).toThrow(
        TelemetryValidationError,
      );
    });

    it('should reject an event missing timestamp', () => {
      const event = validEvent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (event as any).timestamp;

      expect(() => telemetryBus.emitEvent(event)).toThrow(
        TelemetryValidationError,
      );
    });

    it('should reject an event missing durationMs', () => {
      const event = validEvent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (event as any).durationMs;

      expect(() => telemetryBus.emitEvent(event)).toThrow(
        TelemetryValidationError,
      );
    });

    it('should reject an event missing status', () => {
      const event = validEvent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (event as any).status;

      expect(() => telemetryBus.emitEvent(event)).toThrow(
        TelemetryValidationError,
      );
    });

    it('should list all missing fields in the error', () => {
      const event = {} as TelemetryEvent;

      try {
        telemetryBus.emitEvent(event);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TelemetryValidationError);
        const validationErr = err as TelemetryValidationError;
        expect(validationErr.missingFields).toEqual(
          expect.arrayContaining([
            'traceId',
            'stage',
            'timestamp',
            'durationMs',
            'status',
          ]),
        );
      }
    });

    it('should accept a valid event without throwing', () => {
      expect(() => telemetryBus.emitEvent(validEvent())).not.toThrow();
    });

    it('should accept an event with optional metadata', () => {
      const event = validEvent({ metadata: { model: 'gpt-4', tokens: 100 } });
      expect(() => telemetryBus.emitEvent(event)).not.toThrow();
    });
  });

  // ========================================================================
  // Buffering & flush
  // ========================================================================

  describe('buffering and flush', () => {
    it('should buffer emitted events', () => {
      telemetryBus.emitEvent(validEvent());
      telemetryBus.emitEvent(validEvent({ stage: 'classifier' }));

      expect(telemetryBus.bufferedCount).toBe(2);
    });

    it('should deliver buffered events to flush handlers', () => {
      const handler = vi.fn();
      telemetryBus.onFlush(handler);

      telemetryBus.emitEvent(validEvent({ traceId: 'a' }));
      telemetryBus.emitEvent(validEvent({ traceId: 'b' }));
      telemetryBus.flush();

      expect(handler).toHaveBeenCalledOnce();
      const delivered: TelemetryEvent[] = handler.mock.calls[0][0];
      expect(delivered).toHaveLength(2);
      expect(delivered[0].traceId).toBe('a');
      expect(delivered[1].traceId).toBe('b');
    });

    it('should clear the buffer after flush', () => {
      telemetryBus.emitEvent(validEvent());
      telemetryBus.flush();

      expect(telemetryBus.bufferedCount).toBe(0);
    });

    it('should not call handlers when buffer is empty', () => {
      const handler = vi.fn();
      telemetryBus.onFlush(handler);

      telemetryBus.flush();

      expect(handler).not.toHaveBeenCalled();
    });

    it('should deliver events to multiple flush handlers', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      telemetryBus.onFlush(h1);
      telemetryBus.onFlush(h2);

      telemetryBus.emitEvent(validEvent());
      telemetryBus.flush();

      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it('should give each handler an independent copy of the buffer', () => {
      const snapshots: TelemetryEvent[][] = [];
      telemetryBus.onFlush((events) => {
        snapshots.push(events);
        // Mutate the array — should not affect the next handler.
        events.length = 0;
      });
      telemetryBus.onFlush((events) => snapshots.push(events));

      telemetryBus.emitEvent(validEvent());
      telemetryBus.flush();

      // First handler cleared its copy; second handler should still see 1 event.
      expect(snapshots[0]).toHaveLength(0); // mutated
      expect(snapshots[1]).toHaveLength(1); // independent copy
    });
  });

  // ========================================================================
  // Synchronous emit (Req 5.1.4)
  // ========================================================================

  describe('synchronous emit', () => {
    it('should emit the "event" EventEmitter event synchronously', () => {
      const received: TelemetryEvent[] = [];
      telemetryBus.on('event', (evt: TelemetryEvent) => received.push(evt));

      const event = validEvent({ stage: 'router' });
      telemetryBus.emitEvent(event);

      // If emit were async, received would still be empty here.
      expect(received).toHaveLength(1);
      expect(received[0].stage).toBe('router');
    });
  });
});
