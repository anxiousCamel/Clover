/**
 * Subagent-related error classes for recursion depth limits
 * and execution timeouts.
 */

// ---------------------------------------------------------------------------
// MaxDepthExceededError
// ---------------------------------------------------------------------------

export class MaxDepthExceededError extends Error {
  public readonly currentDepth: number;
  public readonly maxDepth: number;

  constructor(currentDepth: number, maxDepth: number) {
    super(
      `Subagent spawn rejected: current depth ${currentDepth} exceeds maximum allowed depth of ${maxDepth}`,
    );
    this.name = 'MaxDepthExceededError';
    this.currentDepth = currentDepth;
    this.maxDepth = maxDepth;
  }
}

// ---------------------------------------------------------------------------
// SubagentTimeoutError
// ---------------------------------------------------------------------------

export class SubagentTimeoutError extends Error {
  public readonly subagentId: string;
  public readonly goal: string;
  public readonly timeoutMs: number;

  constructor(subagentId: string, goal: string, timeoutMs: number) {
    super(
      `Subagent "${subagentId}" timed out after ${timeoutMs}ms while executing goal: "${goal}"`,
    );
    this.name = 'SubagentTimeoutError';
    this.subagentId = subagentId;
    this.goal = goal;
    this.timeoutMs = timeoutMs;
  }
}
