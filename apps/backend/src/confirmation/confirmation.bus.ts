/**
 * Confirmation Bus — manages pending confirmation requests for
 * destructive operations. Emits requests, awaits user response,
 * and rejects with timeout if no response within the configured window.
 */

import { config } from '../config/config.js';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ConfirmationTimeoutError extends Error {
  constructor(requestId: string) {
    super(`Confirmation timed out for request ${requestId}`);
    this.name = 'ConfirmationTimeoutError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfirmationRequest {
  requestId: string;
  toolName: string;
  operation: string;
  details: string;
  args: unknown;
}

interface PendingEntry {
  resolve: (approved: boolean) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const pending = new Map<string, PendingEntry>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a confirmation request and return a promise that resolves
 * to `true` (approved) or `false` (denied).
 *
 * Rejects with ConfirmationTimeoutError if no response arrives
 * within `config.confirmation.timeoutMs` (default 60 s).
 */
export function request(data: ConfirmationRequest): Promise<boolean> {
  return new Promise<boolean>((res, rej) => {
    const timer = setTimeout(() => {
      pending.delete(data.requestId);
      rej(new ConfirmationTimeoutError(data.requestId));
    }, config.confirmation.timeoutMs);

    pending.set(data.requestId, { resolve: res, reject: rej, timer });
  });
}

/**
 * Resolve a pending confirmation request.
 *
 * @param requestId - The id of the pending request.
 * @param approved  - `true` to approve, `false` to deny.
 */
export function resolve(requestId: string, approved: boolean): void {
  const entry = pending.get(requestId);
  if (!entry) return;

  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.resolve(approved);
}
