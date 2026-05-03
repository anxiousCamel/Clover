/**
 * Property-Based Test — Property 11: Flexible Indent Matching and Preservation
 *
 * **Validates: Requirements 2.4.1, 2.4.2, 2.4.3**
 *
 * For any search string and for any file content where the search string
 * appears with different leading whitespace, when `flexibleIndent` is enabled
 * the PatchEngine SHALL:
 *   - Find the match regardless of indentation differences (Req 2.4.1, 2.4.2)
 *   - Preserve the original file's indentation level at the match location (Req 2.4.3)
 *
 * Generator strategy:
 *   - Generate code-like strings with varying indentation (spaces/tabs, 0–8 levels).
 *   - Embed a search string with one indentation level in the file.
 *   - Provide the search string with a *different* indentation level.
 *   - Verify match is found and original indent is preserved in the replacement.
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
 * Build a PatchInput with flexibleIndent enabled.
 */
function makePatchInput(
  searchString: string,
  replaceString: string,
): PatchInput {
  return {
    filePath: TEST_FILE,
    searchString,
    replaceString,
    flexibleIndent: true,
  };
}

/**
 * Generate a "needle" — a code-like identifier that won't appear in filler.
 * Uses a distinctive delimiter pattern.
 */
const needleArb = fc
  .stringMatching(/^[a-zA-Z0-9]{3,15}$/)
  .map((s) => `<<${s}>>`);

/**
 * Generate an indentation string: spaces or tabs at 0–8 levels.
 * Level 0 means no indentation.
 */
const indentArb = fc.tuple(
  fc.constantFrom('  ', '    ', '\t'),
  fc.integer({ min: 0, max: 8 }),
).map(([unit, level]) => unit.repeat(level));

/**
 * Generate filler lines that do NOT contain the needle.
 * Each line is a simple alphanumeric string (no leading whitespace).
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
 * Extract the leading whitespace from a string.
 */
function getIndentation(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : '';
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 11: Flexible Indent Matching and Preservation', () => {
  // -------------------------------------------------------------------------
  // Single-line: match found regardless of indent difference (Req 2.4.1, 2.4.2)
  // -------------------------------------------------------------------------
  it('should find single-line match regardless of leading whitespace differences', () => {
    fc.assert(
      fc.property(
        needleArb,
        indentArb,
        indentArb,
        fc.stringMatching(/^[a-z]{1,20}$/),
        fillerLinesArb('<<>>', 1, 8),
        fillerLinesArb('<<>>', 0, 8),
        (needle, fileIndent, searchIndent, replacement, beforeLines, afterLines) => {
          // Ensure filler doesn't contain the needle
          const safeBefore = beforeLines.filter((l) => !l.includes(needle));
          const safeAfter = afterLines.filter((l) => !l.includes(needle));
          if (safeBefore.length < 1) return;

          // Build file content with needle at fileIndent level
          const indentedNeedle = fileIndent + needle;
          const allLines = [...safeBefore, indentedNeedle, ...safeAfter];
          const fileContent = allLines.join('\n');

          // Search string uses a different indent level
          const searchString = searchIndent + needle;
          const input = makePatchInput(searchString, replacement);

          // Should NOT throw — flexibleIndent finds the match
          const result = applyPatch(fileContent, input, TEST_FILE);
          expect(result.patched).toBeDefined();
          // The needle should be replaced
          expect(result.patched).not.toContain(needle);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Single-line: replacement preserves original file indentation (Req 2.4.3)
  // -------------------------------------------------------------------------
  it('should preserve original file indentation in the replacement', () => {
    fc.assert(
      fc.property(
        needleArb,
        indentArb,
        indentArb,
        fc.stringMatching(/^[a-z]{1,20}$/),
        fillerLinesArb('<<>>', 1, 8),
        fillerLinesArb('<<>>', 0, 8),
        (needle, fileIndent, searchIndent, replacement, beforeLines, afterLines) => {
          const safeBefore = beforeLines.filter((l) => !l.includes(needle));
          const safeAfter = afterLines.filter((l) => !l.includes(needle));
          if (safeBefore.length < 1) return;

          // Build file content with needle at fileIndent level
          const indentedNeedle = fileIndent + needle;
          const allLines = [...safeBefore, indentedNeedle, ...safeAfter];
          const fileContent = allLines.join('\n');

          // Search with different indent
          const searchString = searchIndent + needle;
          const input = makePatchInput(searchString, replacement);

          const result = applyPatch(fileContent, input, TEST_FILE);

          // Find the replacement line in the result
          const resultLines = result.patched.split('\n');
          const replacementLine = resultLines.find((l) =>
            l.trimStart() === replacement,
          );

          expect(replacementLine).toBeDefined();
          // The replacement line should have the ORIGINAL file's indentation
          expect(getIndentation(replacementLine!)).toBe(fileIndent);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Multi-line: match found with different indentation (Req 2.4.1, 2.4.2)
  // -------------------------------------------------------------------------
  it('should find multi-line match regardless of leading whitespace differences', () => {
    fc.assert(
      fc.property(
        fc.array(needleArb, { minLength: 2, maxLength: 4 }),
        indentArb,
        indentArb,
        fc.stringMatching(/^[a-z]{1,20}$/),
        fillerLinesArb('<<>>', 1, 6),
        fillerLinesArb('<<>>', 0, 6),
        (needleLines, fileIndent, searchIndent, replacement, beforeLines, afterLines) => {
          // Ensure all needle lines are unique to avoid ambiguous matches
          const uniqueNeedles = [...new Set(needleLines)];
          if (uniqueNeedles.length < 2) return;

          const safeBefore = beforeLines.filter(
            (l) => !uniqueNeedles.some((n) => l.includes(n)),
          );
          const safeAfter = afterLines.filter(
            (l) => !uniqueNeedles.some((n) => l.includes(n)),
          );
          if (safeBefore.length < 1) return;

          // Build file content: needle lines indented at fileIndent level
          const indentedNeedleLines = uniqueNeedles.map((n) => fileIndent + n);
          const allLines = [
            ...safeBefore,
            ...indentedNeedleLines,
            ...safeAfter,
          ];
          const fileContent = allLines.join('\n');

          // Search string uses different indent
          const searchString = uniqueNeedles
            .map((n) => searchIndent + n)
            .join('\n');
          const input = makePatchInput(searchString, replacement);

          // Should NOT throw — flexibleIndent finds the match
          const result = applyPatch(fileContent, input, TEST_FILE);
          expect(result.patched).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Multi-line: replacement preserves original indentation (Req 2.4.3)
  // -------------------------------------------------------------------------
  it('should preserve original indentation for multi-line replacement', () => {
    fc.assert(
      fc.property(
        fc.array(needleArb, { minLength: 2, maxLength: 4 }),
        indentArb,
        indentArb,
        fc.array(fc.stringMatching(/^[a-z]{1,20}$/), {
          minLength: 1,
          maxLength: 3,
        }),
        fillerLinesArb('<<>>', 1, 6),
        fillerLinesArb('<<>>', 0, 6),
        (needleLines, fileIndent, searchIndent, replaceLines, beforeLines, afterLines) => {
          const uniqueNeedles = [...new Set(needleLines)];
          if (uniqueNeedles.length < 2) return;

          const safeBefore = beforeLines.filter(
            (l) => !uniqueNeedles.some((n) => l.includes(n)),
          );
          const safeAfter = afterLines.filter(
            (l) => !uniqueNeedles.some((n) => l.includes(n)),
          );
          if (safeBefore.length < 1) return;

          // Build file content with needle lines at fileIndent
          const indentedNeedleLines = uniqueNeedles.map((n) => fileIndent + n);
          const allLines = [
            ...safeBefore,
            ...indentedNeedleLines,
            ...safeAfter,
          ];
          const fileContent = allLines.join('\n');

          // Search with different indent
          const searchString = uniqueNeedles
            .map((n) => searchIndent + n)
            .join('\n');
          const replaceString = replaceLines.join('\n');
          const input = makePatchInput(searchString, replaceString);

          const result = applyPatch(fileContent, input, TEST_FILE);

          // The first replacement line should have the original file's indentation
          const resultLines = result.patched.split('\n');
          const firstReplaceLine = resultLines.find(
            (l) => l.trimStart() === replaceLines[0],
          );
          expect(firstReplaceLine).toBeDefined();
          expect(getIndentation(firstReplaceLine!)).toBe(fileIndent);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Works with both spaces and tabs at varying levels (0–8)
  // -------------------------------------------------------------------------
  it('should work with spaces and tabs at all indent levels 0–8', () => {
    fc.assert(
      fc.property(
        needleArb,
        fc.constantFrom('  ', '    ', '\t'),
        fc.integer({ min: 0, max: 8 }),
        fc.constantFrom('  ', '    ', '\t'),
        fc.integer({ min: 0, max: 8 }),
        fillerLinesArb('<<>>', 1, 6),
        fillerLinesArb('<<>>', 0, 6),
        (needle, fileUnit, fileLevel, searchUnit, searchLevel, beforeLines, afterLines) => {
          const safeBefore = beforeLines.filter((l) => !l.includes(needle));
          const safeAfter = afterLines.filter((l) => !l.includes(needle));
          if (safeBefore.length < 1) return;

          const fileIndent = fileUnit.repeat(fileLevel);
          const searchIndent = searchUnit.repeat(searchLevel);

          // Use a unique replacement that won't collide with filler or needle
          const replacement = '##REPLACED##';

          // Build file content with needle at file indent
          const indentedNeedle = fileIndent + needle;
          const allLines = [...safeBefore, indentedNeedle, ...safeAfter];
          const fileContent = allLines.join('\n');

          // Search with different indent type and level
          const searchString = searchIndent + needle;
          const input = makePatchInput(searchString, replacement);

          const result = applyPatch(fileContent, input, TEST_FILE);

          // Match found
          expect(result.patched).toBeDefined();
          expect(result.patched).not.toContain(needle);

          // Original indentation preserved — find the unique replacement line
          const resultLines = result.patched.split('\n');
          const replacementLine = resultLines.find(
            (l) => l.trimStart() === replacement,
          );
          expect(replacementLine).toBeDefined();
          expect(getIndentation(replacementLine!)).toBe(fileIndent);
        },
      ),
      { numRuns: 100 },
    );
  });
});
