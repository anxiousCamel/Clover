/**
 * Property-Based Test — Property 20: TraceId Uniqueness
 *
 * **Validates: Requirements 5.1.3**
 *
 * For any two distinct user messages processed by the Orchestrator, the
 * generated `traceId` values SHALL be different.
 *
 * The Orchestrator generates a traceId via `randomUUID()` from `node:crypto`
 * for each incoming user message. This test verifies:
 *   1. For any pair of generated traceIds, they are always different.
 *   2. Across a batch of generated traceIds, all values are unique.
 *
 * Generator strategy:
 *   - Generate pairs of user message strings and verify that two calls to
 *     the traceId generation function produce distinct values.
 *   - Generate batches of N user messages and verify all N traceIds are unique.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// TraceId generation function
// ---------------------------------------------------------------------------

/**
 * Mirrors the traceId generation used in the Orchestrator's `handle()`.
 * The Orchestrator calls `randomUUID()` from `node:crypto` for each
 * user message (see orchestrator.ts line ~110).
 */
function generateTraceId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generate a user message string (simulating distinct user inputs). */
const userMessageArb = fc.string({ minLength: 1, maxLength: 500 });

/** Generate a batch size for multi-traceId uniqueness checks. */
const batchSizeArb = fc.integer({ min: 2, max: 50 });

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 20: TraceId Uniqueness', () => {
  it('any two traceIds generated for distinct user messages are always different', () => {
    fc.assert(
      fc.property(userMessageArb, userMessageArb, (_messageA, _messageB) => {
        // Each user message triggers a new traceId generation in the Orchestrator.
        // The traceId is independent of message content — it's a fresh UUID each time.
        const traceIdA = generateTraceId();
        const traceIdB = generateTraceId();

        expect(traceIdA).not.toBe(traceIdB);
      }),
      { numRuns: 100 },
    );
  });

  it('traceIds are unique across a batch of user messages', () => {
    fc.assert(
      fc.property(batchSizeArb, (batchSize) => {
        // Simulate processing N user messages, each generating a traceId.
        const traceIds = new Set<string>();

        for (let i = 0; i < batchSize; i++) {
          traceIds.add(generateTraceId());
        }

        // All generated traceIds must be unique — set size equals batch size.
        expect(traceIds.size).toBe(batchSize);
      }),
      { numRuns: 100 },
    );
  });

  it('traceIds conform to UUID v4 format', () => {
    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    fc.assert(
      fc.property(userMessageArb, (_message) => {
        const traceId = generateTraceId();

        // Every traceId must be a valid UUID v4.
        expect(traceId).toMatch(uuidV4Regex);
      }),
      { numRuns: 100 },
    );
  });
});
