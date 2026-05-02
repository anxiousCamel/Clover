/**
 * Unit tests for Confirmation Bus.
 *
 * Validates: Requirements 19.3, 19.4, 19.5
 *
 * Tests that approval resolves true, denial resolves false,
 * and 60s timeout rejects with ConfirmationTimeoutError.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the config module before importing the bus
vi.mock('../../config/config.js', () => ({
  config: {
    confirmation: { timeoutMs: 60_000 },
  },
}));

import {
  request,
  resolve,
  ConfirmationTimeoutError,
  type ConfirmationRequest,
} from '../confirmation.bus.js';

function makeRequest(overrides: Partial<ConfirmationRequest> = {}): ConfirmationRequest {
  return {
    requestId: overrides.requestId ?? 'req-1',
    toolName: overrides.toolName ?? 'delete-file',
    operation: overrides.operation ?? 'delete',
    details: overrides.details ?? 'Delete file foo.txt',
    args: overrides.args ?? { path: 'foo.txt' },
  };
}

describe('Confirmation Bus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Req 19.3: Approval resolves true ──────────────────────────────

  it('should resolve true when user approves', async () => {
    const promise = request(makeRequest({ requestId: 'approve-1' }));

    // Simulate user clicking "Approve"
    resolve('approve-1', true);

    await expect(promise).resolves.toBe(true);
  });

  // ── Req 19.4: Denial resolves false ───────────────────────────────

  it('should resolve false when user denies', async () => {
    const promise = request(makeRequest({ requestId: 'deny-1' }));

    // Simulate user clicking "Deny"
    resolve('deny-1', false);

    await expect(promise).resolves.toBe(false);
  });

  // ── Req 19.5: 60s timeout rejects with TimeoutError ──────────────

  it('should reject with ConfirmationTimeoutError after 60s', async () => {
    const promise = request(makeRequest({ requestId: 'timeout-1' }));

    // Advance time past the 60s timeout
    vi.advanceTimersByTime(60_000);

    await expect(promise).rejects.toThrow(ConfirmationTimeoutError);
    await expect(promise).rejects.toThrow('Confirmation timed out for request timeout-1');
  });

  it('should not reject before 60s have elapsed', async () => {
    const promise = request(makeRequest({ requestId: 'not-yet-1' }));

    // Advance to just before the timeout
    vi.advanceTimersByTime(59_999);

    // The promise should still be pending — resolve it manually to verify
    resolve('not-yet-1', true);

    await expect(promise).resolves.toBe(true);
  });

  // ── Edge: resolve for unknown requestId is a no-op ────────────────

  it('should ignore resolve calls for unknown requestIds', () => {
    // Should not throw
    expect(() => resolve('nonexistent', true)).not.toThrow();
  });

  // ── Edge: resolve after timeout is a no-op ────────────────────────

  it('should ignore resolve calls after timeout has fired', async () => {
    const promise = request(makeRequest({ requestId: 'late-1' }));

    vi.advanceTimersByTime(60_000);

    // Late resolve should not throw
    expect(() => resolve('late-1', true)).not.toThrow();

    await expect(promise).rejects.toThrow(ConfirmationTimeoutError);
  });
});
