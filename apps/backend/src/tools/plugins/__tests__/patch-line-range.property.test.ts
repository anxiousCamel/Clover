/**
 * Property-Based Test — Property 9: Line Range Restricts Search Scope
 *
 * **Validates: Requirements 2.2.2**
 *
 * For any file content containing the same search string at two different
 * locations (one inside a given line range, one outside), the PatchEngine
 * with `lineRange` specified SHALL match only the occurrence within the
 * range and apply the replacement there.
 *
 * Generator strategy:
 *   - Generate a distinctive needle string.
 *   - Generate filler lines that do NOT contain the needle.
 *   - Place the needle at two known line positions (one inside a line range,
 *     one outside).
 *   - Specify a lineRange covering only one occurrence.
 *   - Verify the replacement is applied only at the in-range location.
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
 * Build a PatchInput with lineRange and flexibleIndent disabled
 * for exact string matching behavior.
 */
function makePatchInput(
  searchString: string,
  replaceString: string,
  lineRange: { start: number; end: number },
): PatchInput {
  return {
    filePath: TEST_FILE,
    searchString,
    replaceString,
    lineRange,
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
 * Generate a replacement string that is visually distinct from the needle.
 */
const replacementArb = fc
  .stringMatching(/^[a-zA-Z0-9]{1,20}$/)
  .map((s) => `[[${s}]]`);

/**
 * Generate filler lines that do NOT contain the needle.
 * Each line is a simple alphanumeric string.
 */
function fillerLinesArb(needle: string, minLines: number, maxLines: number) {
  return fc
    .array(fc.stringMatching(/^[a-z]{1,40}$/), {
      minLength: minLines,
      maxLength: maxLines,
    })
    .filter((lines) => lines.every((line) => !line.includes(needle)));
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 9: Line Range Restricts Search Scope', () => {
  // -------------------------------------------------------------------------
  // Core property: needle inside range is replaced, needle outside is not
  // -------------------------------------------------------------------------
  it('should replace only the occurrence within the specified line range', () => {
    fc.assert(
      fc.property(
        needleArb,
        replacementArb,
        // Filler sections: before first needle, between needles, after second needle
        fillerLinesArb('<<>>', 1, 5),
        fillerLinesArb('<<>>', 1, 5),
        fillerLinesArb('<<>>', 1, 5),
        // Whether the in-range needle is the first or second occurrence
        fc.boolean(),
        (needle, replacement, beforeLines, middleLines, afterLines, inRangeFirst) => {
          // Filter filler to ensure no accidental needle matches
          const safeBefore = beforeLines.filter((l) => !l.includes(needle));
          const safeMiddle = middleLines.filter((l) => !l.includes(needle));
          const safeAfter = afterLines.filter((l) => !l.includes(needle));

          if (safeBefore.length < 1 || safeMiddle.length < 1 || safeAfter.length < 1) return;

          // Build file: [before] [needle] [middle] [needle] [after]
          const allLines = [
            ...safeBefore,
            needle,
            ...safeMiddle,
            needle,
            ...safeAfter,
          ];
          const fileContent = allLines.join('\n');

          // Line positions (1-indexed)
          const firstNeedleLine = safeBefore.length + 1;
          const secondNeedleLine = safeBefore.length + 1 + safeMiddle.length + 1;

          let lineRange: { start: number; end: number };
          let inRangeLine: number;
          let outOfRangeLine: number;

          if (inRangeFirst) {
            // Range covers the first needle only
            lineRange = { start: firstNeedleLine, end: firstNeedleLine };
            inRangeLine = firstNeedleLine;
            outOfRangeLine = secondNeedleLine;
          } else {
            // Range covers the second needle only
            lineRange = { start: secondNeedleLine, end: secondNeedleLine };
            inRangeLine = secondNeedleLine;
            outOfRangeLine = firstNeedleLine;
          }

          const input = makePatchInput(needle, replacement, lineRange);
          const result = applyPatch(fileContent, input, TEST_FILE);

          // Split result into lines to verify per-line correctness
          const resultLines = result.patched.split('\n');

          // The in-range line should contain the replacement, not the needle
          expect(resultLines[inRangeLine - 1]).toContain(replacement);
          expect(resultLines[inRangeLine - 1]).not.toContain(needle);

          // The out-of-range line should still contain the original needle
          expect(resultLines[outOfRangeLine - 1]).toContain(needle);
          expect(resultLines[outOfRangeLine - 1]).not.toContain(replacement);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Range spanning multiple lines still restricts scope correctly
  // -------------------------------------------------------------------------
  it('should restrict search to a multi-line range and only replace within it', () => {
    fc.assert(
      fc.property(
        needleArb,
        replacementArb,
        fillerLinesArb('<<>>', 2, 6),
        fillerLinesArb('<<>>', 1, 4),
        fillerLinesArb('<<>>', 1, 4),
        fillerLinesArb('<<>>', 2, 6),
        (needle, replacement, topFiller, midFillerA, midFillerB, bottomFiller) => {
          const safeTop = topFiller.filter((l) => !l.includes(needle));
          const safeMidA = midFillerA.filter((l) => !l.includes(needle));
          const safeMidB = midFillerB.filter((l) => !l.includes(needle));
          const safeBottom = bottomFiller.filter((l) => !l.includes(needle));

          if (safeTop.length < 2 || safeMidA.length < 1 || safeMidB.length < 1 || safeBottom.length < 2) return;

          // Structure:
          //   [topFiller]          <- outside range (above)
          //   [needle]             <- first occurrence (outside range)
          //   [midFillerA]
          //   --- range start ---
          //   [midFillerB]
          //   [needle]             <- second occurrence (inside range)
          //   [midFillerB again]
          //   --- range end ---
          //   [bottomFiller]       <- outside range (below)

          const allLines = [
            ...safeTop,
            needle,
            ...safeMidA,
            ...safeMidB,
            needle,
            ...safeMidB,
            ...safeBottom,
          ];
          const fileContent = allLines.join('\n');

          // Calculate line positions (1-indexed)
          const firstNeedleLine = safeTop.length + 1;
          const rangeStart = safeTop.length + 1 + safeMidA.length + 1; // first line of midFillerB section
          const secondNeedleLine = rangeStart + safeMidB.length;
          const rangeEnd = secondNeedleLine + safeMidB.length; // last line of second midFillerB

          const lineRange = { start: rangeStart, end: rangeEnd };

          const input = makePatchInput(needle, replacement, lineRange);
          const result = applyPatch(fileContent, input, TEST_FILE);

          const resultLines = result.patched.split('\n');

          // Second needle (in range) should be replaced
          expect(resultLines[secondNeedleLine - 1]).toContain(replacement);
          expect(resultLines[secondNeedleLine - 1]).not.toContain(needle);

          // First needle (out of range) should remain unchanged
          expect(resultLines[firstNeedleLine - 1]).toContain(needle);
          expect(resultLines[firstNeedleLine - 1]).not.toContain(replacement);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Overall file structure is preserved (only targeted line changes)
  // -------------------------------------------------------------------------
  it('should preserve all lines outside the replacement when lineRange is used', () => {
    fc.assert(
      fc.property(
        needleArb,
        replacementArb,
        fillerLinesArb('<<>>', 2, 8),
        fillerLinesArb('<<>>', 2, 8),
        fillerLinesArb('<<>>', 2, 8),
        (needle, replacement, beforeLines, middleLines, afterLines) => {
          const safeBefore = beforeLines.filter((l) => !l.includes(needle));
          const safeMiddle = middleLines.filter((l) => !l.includes(needle));
          const safeAfter = afterLines.filter((l) => !l.includes(needle));

          if (safeBefore.length < 2 || safeMiddle.length < 2 || safeAfter.length < 2) return;

          // [before] [needle] [middle] [needle] [after]
          const allLines = [
            ...safeBefore,
            needle,
            ...safeMiddle,
            needle,
            ...safeAfter,
          ];
          const fileContent = allLines.join('\n');

          const firstNeedleLine = safeBefore.length + 1;
          // Target the first needle with a tight range
          const lineRange = { start: firstNeedleLine, end: firstNeedleLine };

          const input = makePatchInput(needle, replacement, lineRange);
          const result = applyPatch(fileContent, input, TEST_FILE);

          const resultLines = result.patched.split('\n');

          // All lines before the needle should be unchanged
          for (let i = 0; i < safeBefore.length; i++) {
            expect(resultLines[i]).toBe(safeBefore[i]);
          }

          // All middle filler lines should be unchanged
          const middleStart = firstNeedleLine; // 0-indexed: after the replaced needle
          for (let i = 0; i < safeMiddle.length; i++) {
            expect(resultLines[middleStart + i]).toBe(safeMiddle[i]);
          }

          // The second needle should be unchanged
          const secondNeedleIdx = middleStart + safeMiddle.length;
          expect(resultLines[secondNeedleIdx]).toBe(needle);

          // All lines after the second needle should be unchanged
          for (let i = 0; i < safeAfter.length; i++) {
            expect(resultLines[secondNeedleIdx + 1 + i]).toBe(safeAfter[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
