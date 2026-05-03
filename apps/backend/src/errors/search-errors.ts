/**
 * Search-related error classes for invalid regex patterns
 * and invalid glob patterns.
 */

// ---------------------------------------------------------------------------
// InvalidRegexError
// ---------------------------------------------------------------------------

export class InvalidRegexError extends Error {
  public readonly pattern: string;

  constructor(pattern: string, reason: string) {
    super(
      `Invalid regex pattern "${pattern}": ${reason}`,
    );
    this.name = 'InvalidRegexError';
    this.pattern = pattern;
  }
}

// ---------------------------------------------------------------------------
// InvalidGlobError
// ---------------------------------------------------------------------------

export class InvalidGlobError extends Error {
  public readonly pattern: string;

  constructor(pattern: string, reason: string) {
    super(
      `Invalid glob pattern "${pattern}": ${reason}`,
    );
    this.name = 'InvalidGlobError';
    this.pattern = pattern;
  }
}
