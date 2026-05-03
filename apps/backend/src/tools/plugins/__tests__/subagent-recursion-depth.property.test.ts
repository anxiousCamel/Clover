/**
 * Property-Based Test — Property 14: Subagent Recursion Depth Limit
 *
 * **Validates: Requirements 3.3.1, 3.3.2, 3.3.3**
 *
 * For any configured `maxSubagentDepth` D and for any chain of subagent
 * spawns, spawning at depth D+1 SHALL be rejected with an error, and
 * spawning at depth ≤ D SHALL succeed. Depth SHALL reset to 0 for each
 * new top-level user message.
 *
 * Generator strategy:
 *   - Generate `maxSubagentDepth` D in [1, 10].
 *   - Generate a session ID and a goal string.
 *   - Simulate spawn chains by incrementing depth, verify depth ≤ D
 *     accepted and depth D+1 rejected with MaxDepthExceededError message.
 *   - After reset, verify depth returns to 0 and spawning succeeds again.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  getDepth,
  incrementDepth,
  resetDepth,
} from '../spawn-subagent.tool.js';
import { config } from '../../../config/config.js';
import { MaxDepthExceededError } from '../../../errors/subagent-errors.js';
import spawnSubagentPlugin from '../spawn-subagent.tool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ToolContext for testing. */
function makeToolContext(sessionId: string) {
  return {
    workspacePath: '/test/workspace',
    sessionId,
    execGuard: {
      execute: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    },
    emitEvent: vi.fn(),
  };
}

/** Store original maxSubagentDepth so we can restore it after each test. */
const originalMaxDepth = config.maxSubagentDepth;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generate a valid maxSubagentDepth in [1, 10]. */
const maxDepthArb = fc.integer({ min: 1, max: 10 });

/** Generate a session ID (UUID-like). */
const sessionIdArb = fc.uuid();

/** Generate a non-empty goal string. */
const goalArb = fc.string({ minLength: 1, maxLength: 100 });

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  // Restore original config value
  (config as Record<string, unknown>).maxSubagentDepth = originalMaxDepth;
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 14: Subagent Recursion Depth Limit', () => {
  it('spawning at depth ≤ D is accepted (Req 3.3.1, 3.3.2)', () => {
    fc.assert(
      fc.property(
        maxDepthArb,
        sessionIdArb,
        (maxDepth, sessionId) => {
          // Configure the depth limit
          (config as Record<string, unknown>).maxSubagentDepth = maxDepth;

          // Reset depth for this session to start clean
          resetDepth(sessionId);

          // Spawn subagents up to the max depth — all should succeed
          for (let i = 0; i < maxDepth; i++) {
            const currentDepth = getDepth(sessionId);
            expect(currentDepth).toBe(i);
            expect(currentDepth).toBeLessThan(maxDepth);

            // Increment depth (simulating what execute() does on success)
            incrementDepth(sessionId);
          }

          // After maxDepth increments, depth should equal maxDepth
          expect(getDepth(sessionId)).toBe(maxDepth);

          // Clean up
          resetDepth(sessionId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('spawning at depth D+1 is rejected with MaxDepthExceededError (Req 3.3.1, 3.3.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        maxDepthArb,
        sessionIdArb,
        goalArb,
        async (maxDepth, sessionId, goal) => {
          // Configure the depth limit
          (config as Record<string, unknown>).maxSubagentDepth = maxDepth;

          // Reset and push depth to the limit
          resetDepth(sessionId);
          for (let i = 0; i < maxDepth; i++) {
            incrementDepth(sessionId);
          }
          expect(getDepth(sessionId)).toBe(maxDepth);

          const ctx = makeToolContext(sessionId);

          // Attempt to spawn at depth D — should be rejected
          const result = await spawnSubagentPlugin.execute(
            { goal },
            ctx,
          );

          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();

          // Verify the error message matches MaxDepthExceededError format
          const expectedError = new MaxDepthExceededError(maxDepth, maxDepth);
          expect(result.error).toBe(expectedError.message);

          // Clean up
          resetDepth(sessionId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('spawning at depth < D succeeds via execute() (Req 3.3.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        maxDepthArb,
        sessionIdArb,
        goalArb,
        fc.integer({ min: 0, max: 9 }),
        async (maxDepth, sessionId, goal, attemptDepthRaw) => {
          // Ensure attemptDepth is strictly less than maxDepth
          const attemptDepth = attemptDepthRaw % maxDepth;

          // Configure the depth limit
          (config as Record<string, unknown>).maxSubagentDepth = maxDepth;

          // Reset and push depth to attemptDepth
          resetDepth(sessionId);
          for (let i = 0; i < attemptDepth; i++) {
            incrementDepth(sessionId);
          }
          expect(getDepth(sessionId)).toBe(attemptDepth);

          const ctx = makeToolContext(sessionId);

          // Attempt to spawn — should succeed since depth < maxDepth
          const result = await spawnSubagentPlugin.execute(
            { goal },
            ctx,
          );

          expect(result.success).toBe(true);
          expect(result.error).toBeUndefined();
          expect(result.output).toContain('Subagent spawned');

          // Clean up
          resetDepth(sessionId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('depth resets to 0 for each new top-level user message (Req 3.3.3)', () => {
    fc.assert(
      fc.property(
        maxDepthArb,
        sessionIdArb,
        fc.integer({ min: 1, max: 10 }),
        (maxDepth, sessionId, spawnsBeforeReset) => {
          (config as Record<string, unknown>).maxSubagentDepth = maxDepth;

          // Reset to start clean
          resetDepth(sessionId);
          expect(getDepth(sessionId)).toBe(0);

          // Simulate some spawns (up to spawnsBeforeReset, capped at maxDepth)
          const actualSpawns = Math.min(spawnsBeforeReset, maxDepth);
          for (let i = 0; i < actualSpawns; i++) {
            incrementDepth(sessionId);
          }
          expect(getDepth(sessionId)).toBe(actualSpawns);
          expect(getDepth(sessionId)).toBeGreaterThan(0);

          // Simulate new top-level user message by resetting depth
          resetDepth(sessionId);

          // Depth must be back to 0
          expect(getDepth(sessionId)).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('after reset, previously rejected depth is accepted again (Req 3.3.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        maxDepthArb,
        sessionIdArb,
        goalArb,
        async (maxDepth, sessionId, goal) => {
          (config as Record<string, unknown>).maxSubagentDepth = maxDepth;

          // Push depth to the limit so spawning is rejected
          resetDepth(sessionId);
          for (let i = 0; i < maxDepth; i++) {
            incrementDepth(sessionId);
          }

          const ctx = makeToolContext(sessionId);

          // Verify rejection at max depth
          const rejectedResult = await spawnSubagentPlugin.execute(
            { goal },
            ctx,
          );
          expect(rejectedResult.success).toBe(false);

          // Simulate new top-level user message
          resetDepth(sessionId);
          expect(getDepth(sessionId)).toBe(0);

          // Now spawning should succeed again
          const acceptedResult = await spawnSubagentPlugin.execute(
            { goal },
            ctx,
          );
          expect(acceptedResult.success).toBe(true);
          expect(acceptedResult.output).toContain('Subagent spawned');

          // Clean up
          resetDepth(sessionId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
