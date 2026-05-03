/**
 * Patch-related error classes for search-and-replace failures
 * and line range validation.
 */

// ---------------------------------------------------------------------------
// PatchNotFoundError
// ---------------------------------------------------------------------------

export class PatchNotFoundError extends Error {
  public readonly filePath: string;

  constructor(filePath: string, searchString: string) {
    const preview =
      searchString.length > 80
        ? searchString.slice(0, 80) + '…'
        : searchString;
    super(
      `Search text not found in "${filePath}". Pattern: "${preview}"`,
    );
    this.name = 'PatchNotFoundError';
    this.filePath = filePath;
  }
}

// ---------------------------------------------------------------------------
// LineRangeError
// ---------------------------------------------------------------------------

export class LineRangeError extends Error {
  public readonly filePath: string;
  public readonly requestedEnd: number;
  public readonly actualLineCount: number;

  constructor(filePath: string, requestedEnd: number, actualLineCount: number) {
    super(
      `Line range exceeds file length in "${filePath}": requested line ${requestedEnd}, but file has ${actualLineCount} lines`,
    );
    this.name = 'LineRangeError';
    this.filePath = filePath;
    this.requestedEnd = requestedEnd;
    this.actualLineCount = actualLineCount;
  }
}
