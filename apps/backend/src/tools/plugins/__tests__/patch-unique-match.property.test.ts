/**
 * Property-Based Test — Property 7: Patch Unique Match Enforcement
 *
 * **Validates: Requirements 2.1.2, 2.1.3, 2.1.4**
 *
 * For any file content and for any search string, the PatchEngine SHALL:
 *   - Accept the patch if the search string matches exactly one location
 *   - Return a not-found error if it matches zero locations
 *   - Return an ambiguous-match error if it matches more than one location
 *
 * Generator strategy:
 *   - Generate file content strings, embed search string 0/1/2+ times.
 *   - Verify accept/not-found/ambiguous behavior.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { applyPatch } from '../apply-patch.tool.js';
import type { PatchInput } from '../apply-patch.tool.js';
import { PatchNotFoundError } from '../../../errors/patch-errors.js';
import { AmbiguousMatchError } from '../edit-file.tool.js';

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
): PatchInput {
  return {
    filePath: TEST_FILE,
    searchString,
    replaceString,
    flexibleIndent: false,
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
 * Generate filler lines that do NOT contain the needle.
 * Each line is a simple alphanumeric string.
 */
function fillerLinesArb(needle: string, minLines: number, maxLines: number) {
  return fc
    .array(
      fc.stringMatching(/^[a-z]{1,40}$/),
      { minLength: minLines, maxLength: maxLines },
    )
    .filter((lines) => lines.every((line) => !line.includes(needle)));
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 7: Patch Unique Match Enforcement', () => {
  // -------------------------------------------------------------------------
  // Case 1: Exactly one match → patch succeeds (Req 2.1.2)
  // -------------------------------------------------------------------------
  it('should accept patch when searchString matches exactly 1 location (Req 2.1.2)', () => {
    fc.assert(
      fc.property(
        needleArb,
        fc.string({ minLength: 1, maxLength: 20 }),
        (needle, replacement) => {
          return fc.assert(
            fc.property(
              fillerLinesArb(needle, 1, 10),
              fillerLinesArb(needle, 0, 10),
              (beforeLines, afterLines) => {
                // Build file content with needle appearing exactly once
                const fileContent = [
                  ...beforeLines,
                  needle,
                  ...afterLines,
                ].join('\n');

                const input = makePatchInput(needle, replacement);
                const result = applyPatch(fileContent, input, TEST_FILE);

                // Patch should succeed
                expect(result.patched).toBeDefined();
                // The result should contain the replacement, not the needle
                expect(result.patched).toContain(replacement);
                expect(result.patched).not.toContain(needle);
              },
            ),
            { numRuns: 10 },
          );
        },
      ),
      { numRuns: 10 },
    );
  });

  // -------------------------------------------------------------------------
  // Case 2: Zero matches → PatchNotFoundError (Req 2.1.3)
  // -------------------------------------------------------------------------
  it('should throw PatchNotFoundError when searchString matches 0 locations (Req 2.1.3)', () => {
    fc.assert(
      fc.property(
        needleArb,
        (needle) => {
          return fc.assert(
            fc.property(
              fillerLinesArb(needle, 1, 15),
              (fillerLines) => {
                // File content does NOT contain the needle
                const fileContent = fillerLines.join('\n');

                const input = makePatchInput(needle, 'replacement');

                expect(() => applyPatch(fileContent, input, TEST_FILE)).toThrow(
                  PatchNotFoundError,
                );
              },
            ),
            { numRuns: 10 },
          );
        },
      ),
      { numRuns: 10 },
    );
  });

  // -------------------------------------------------------------------------
  // Case 3: Two or more matches → AmbiguousMatchError (Req 2.1.4)
  // -------------------------------------------------------------------------
  it('should throw AmbiguousMatchError when searchString matches 2+ locations (Req 2.1.4)', () => {
    fc.assert(
      fc.property(
        needleArb,
        fc.integer({ min: 2, max: 5 }),
        (needle, repeatCount) => {
          return fc.assert(
            fc.property(
              fillerLinesArb(needle, 0, 5),
              (fillerLines) => {
                // Build file content with needle appearing repeatCount times,
                // separated by filler lines
                const parts: string[] = [];
                for (let i = 0; i < repeatCount; i++) {
                  if (fillerLines.length > 0 && i < fillerLines.length) {
                    parts.push(fillerLines[i % fillerLines.length]);
                  }
                  parts.push(needle);
                }
                const fileContent = parts.join('\n');

                const input = makePatchInput(needle, 'replacement');

                expect(() => applyPatch(fileContent, input, TEST_FILE)).toThrow(
                  AmbiguousMatchError,
                );
              },
            ),
            { numRuns: 10 },
          );
        },
      ),
      { numRuns: 10 },
    );
  });

  // -------------------------------------------------------------------------
  // Unified property: match count determines outcome
  // -------------------------------------------------------------------------
  it('should enforce unique match: 0→not-found, 1→success, 2+→ambiguous', () => {
    fc.assert(
      fc.property(
        needleArb,
        fc.integer({ min: 0, max: 4 }),
        fc.array(fc.stringMatching(/^[a-z]{1,30}$/), {
          minLength: 1,
          maxLength: 8,
        }),
        (needle, embedCount, fillerLines) => {
          // Filter filler lines to ensure they don't contain the needle
          const safeFiller = fillerLines.filter((l) => !l.includes(needle));
          if (safeFiller.length === 0) return; // skip degenerate case

          // Build file content with needle embedded exactly embedCount times
          const parts: string[] = [];
          for (let i = 0; i < embedCount; i++) {
            parts.push(safeFiller[i % safeFiller.length]);
            parts.push(needle);
          }
          parts.push(safeFiller[0]); // trailing filler
          const fileContent = parts.join('\n');

          const input = makePatchInput(needle, 'REPLACED');

          if (embedCount === 0) {
            // Zero matches → PatchNotFoundError
            expect(() =>
              applyPatch(fileContent, input, TEST_FILE),
            ).toThrow(PatchNotFoundError);
          } else if (embedCount === 1) {
            // Exactly one match → success
            const result = applyPatch(fileContent, input, TEST_FILE);
            expect(result.patched).toContain('REPLACED');
            expect(result.patched).not.toContain(needle);
          } else {
            // Two or more matches → AmbiguousMatchError
            expect(() =>
              applyPatch(fileContent, input, TEST_FILE),
            ).toThrow(AmbiguousMatchError);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
