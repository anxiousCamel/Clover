/**
 * Property-Based Test — Property 8: Patch Preserves Line Endings
 *
 * **Validates: Requirements 2.1.5**
 *
 * For any file content using consistent line endings (all LF or all CRLF),
 * after applying any valid patch (single match), the resulting file SHALL
 * use the same line ending style as the original.
 *
 * Generator strategy:
 *   - Generate multi-line file content with a distinctive needle embedded once.
 *   - Choose LF or CRLF line endings and apply them consistently.
 *   - Apply a valid patch (replacing the needle with a replacement string).
 *   - Verify all line endings in the result match the original style.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { applyPatch } from '../apply-patch.tool.js';
import type { PatchInput } from '../apply-patch.tool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_FILE = 'test-file.txt';

/**
 * Build a PatchInput for testing with flexibleIndent disabled
 * so we get exact string matching behavior.
 */
function makePatchInput(
  searchString: string,
  replaceString: string,
  flexibleIndent = false,
): PatchInput {
  return {
    filePath: TEST_FILE,
    searchString,
    replaceString,
    flexibleIndent,
  };
}

/**
 * Generate a "needle" string that won't accidentally appear in random
 * filler content. Uses a distinctive delimiter pattern.
 */
const needleArb = fc
  .stringMatching(/^[a-zA-Z0-9]{3,15}$/)
  .map((s) => `<<${s}>>`);

/**
 * Generate a replacement string (single or multi-line, LF-only internally).
 */
const replacementArb = fc
  .array(fc.stringMatching(/^[a-z]{1,30}$/), { minLength: 1, maxLength: 4 })
  .map((lines) => lines.join('\n'));

/**
 * Generate filler lines that do NOT contain the needle.
 */
function fillerLinesArb(needle: string, minLines: number, maxLines: number) {
  return fc
    .array(fc.stringMatching(/^[a-z]{1,40}$/), {
      minLength: minLines,
      maxLength: maxLines,
    })
    .filter((lines) => lines.every((line) => !line.includes(needle)));
}

/**
 * Join lines with the specified line ending.
 */
function joinWithEnding(lines: string[], ending: '\r\n' | '\n'): string {
  return lines.join(ending);
}

/**
 * Check that ALL line endings in content are of the expected type.
 * Returns true if the content uses only the expected line ending style.
 */
function hasConsistentLineEndings(
  content: string,
  expectedEnding: '\r\n' | '\n',
): boolean {
  if (expectedEnding === '\r\n') {
    // Every \n must be preceded by \r
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n' && (i === 0 || content[i - 1] !== '\r')) {
        return false;
      }
    }
    return true;
  } else {
    // No \r should appear at all
    return !content.includes('\r');
  }
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 8: Patch Preserves Line Endings', () => {
  // -------------------------------------------------------------------------
  // LF files remain LF after patching
  // -------------------------------------------------------------------------
  it('should preserve LF line endings after applying a valid patch', () => {
    fc.assert(
      fc.property(
        needleArb,
        replacementArb,
        fillerLinesArb('<<>>', 2, 10),
        fillerLinesArb('<<>>', 0, 10),
        (needle, replacement, beforeLines, afterLines) => {
          // Ensure filler doesn't contain the needle
          const safeBefore = beforeLines.filter((l) => !l.includes(needle));
          const safeAfter = afterLines.filter((l) => !l.includes(needle));
          if (safeBefore.length < 1) return; // need at least 1 line before

          // Build file content with LF endings, needle embedded once
          const allLines = [...safeBefore, needle, ...safeAfter];
          const fileContent = joinWithEnding(allLines, '\n');

          const input = makePatchInput(needle, replacement);
          const result = applyPatch(fileContent, input, TEST_FILE);

          // Verify: result uses only LF line endings (no \r)
          expect(hasConsistentLineEndings(result.patched, '\n')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // CRLF files remain CRLF after patching
  // -------------------------------------------------------------------------
  it('should preserve CRLF line endings after applying a valid patch', () => {
    fc.assert(
      fc.property(
        needleArb,
        replacementArb,
        fillerLinesArb('<<>>', 2, 10),
        fillerLinesArb('<<>>', 0, 10),
        (needle, replacement, beforeLines, afterLines) => {
          // Ensure filler doesn't contain the needle
          const safeBefore = beforeLines.filter((l) => !l.includes(needle));
          const safeAfter = afterLines.filter((l) => !l.includes(needle));
          if (safeBefore.length < 1) return; // need at least 1 line before

          // Build file content with CRLF endings, needle embedded once
          const allLines = [...safeBefore, needle, ...safeAfter];
          const fileContent = joinWithEnding(allLines, '\r\n');

          // The searchString uses LF internally (as the user would provide it)
          const input = makePatchInput(needle, replacement);
          const result = applyPatch(fileContent, input, TEST_FILE);

          // Verify: result uses only CRLF line endings
          expect(hasConsistentLineEndings(result.patched, '\r\n')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Unified property: line ending style is preserved regardless of LF/CRLF
  // -------------------------------------------------------------------------
  it('should preserve original line ending style for any valid patch (LF or CRLF)', () => {
    fc.assert(
      fc.property(
        needleArb,
        replacementArb,
        fillerLinesArb('<<>>', 2, 10),
        fillerLinesArb('<<>>', 0, 10),
        fc.constantFrom('\r\n' as const, '\n' as const),
        (needle, replacement, beforeLines, afterLines, lineEnding) => {
          // Ensure filler doesn't contain the needle
          const safeBefore = beforeLines.filter((l) => !l.includes(needle));
          const safeAfter = afterLines.filter((l) => !l.includes(needle));
          if (safeBefore.length < 1) return; // need at least 1 line before

          // Build file content with chosen line ending, needle embedded once
          const allLines = [...safeBefore, needle, ...safeAfter];
          const fileContent = joinWithEnding(allLines, lineEnding);

          const input = makePatchInput(needle, replacement);
          const result = applyPatch(fileContent, input, TEST_FILE);

          // Verify: result preserves the original line ending style
          expect(hasConsistentLineEndings(result.patched, lineEnding)).toBe(
            true,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
