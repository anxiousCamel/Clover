/**
 * Property-Based Test — Property 17: Case Sensitivity Metamorphic Property
 *
 * **Validates: Requirements 4.2.3**
 *
 * For any regex query, the set of results from a case-insensitive search
 * SHALL be a superset of (or equal to) the results from a case-sensitive
 * search with the same query.
 *
 * Generator strategy:
 *   - Generate mixed-case content and queries.
 *   - Create a temp workspace with generated files.
 *   - Run grep-text twice: once case-sensitive, once case-insensitive.
 *   - Verify that every result from the case-sensitive search also
 *     appears in the case-insensitive results (superset property).
 */
import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import grepTextPlugin from '../grep-text.tool.js';
import type { ToolContext } from '@clover/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Track temp dirs for cleanup. */
const tempDirs: string[] = [];

/** Create a temporary workspace directory. */
function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clover-case-meta-'));
  tempDirs.push(dir);
  return dir;
}

/** Build a mock ToolContext for a given workspace path. */
function makeCtx(workspacePath: string): ToolContext {
  return {
    workspacePath,
    sessionId: 'test-session',
    execGuard: {
      execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    },
    emitEvent: () => {},
  };
}

/**
 * Write a file at the given relative path inside the workspace,
 * creating intermediate directories as needed.
 */
function writeFile(
  workspacePath: string,
  relPath: string,
  content: string,
): void {
  const absPath = path.join(workspacePath, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf-8');
}

/**
 * Normalize a path to use forward slashes for cross-platform consistency.
 */
function normalizePath(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Escape regex special characters in a string so it can be used as a
 * literal pattern in a RegExp.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create a unique key for a grep match result (filePath + lineNumber)
 * to enable set-based comparison between case-sensitive and
 * case-insensitive results.
 */
function matchKey(item: { filePath: string; lineNumber: number }): string {
  return `${normalizePath(item.filePath)}:${item.lineNumber}`;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a safe filename segment (lowercase alphanumeric, 1-8 chars). */
const fileSegmentArb = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/);

/** Generate a file extension. */
const extensionArb = fc.constantFrom('.ts', '.js', '.txt', '.md');

/**
 * Generate a relative file path with 0-2 directory depth.
 * Avoids excluded directory names.
 */
const filePathArb = fc
  .tuple(
    fc.array(
      fileSegmentArb.filter(
        (s) =>
          s !== 'node_modules' &&
          s !== 'git' &&
          s !== '.git' &&
          s !== 'node',
      ),
      { minLength: 0, maxLength: 2 },
    ),
    fileSegmentArb,
    extensionArb,
  )
  .map(([dirs, name, ext]) => [...dirs, `${name}${ext}`].join('/'));

/**
 * Generate a mixed-case word (3-8 chars) that contains both upper and
 * lower case letters. This ensures the case sensitivity distinction
 * is exercised.
 */
const mixedCaseWordArb = fc
  .stringMatching(/^[A-Za-z]{3,8}$/)
  .filter((w) => /[a-z]/.test(w) && /[A-Z]/.test(w));

/**
 * Generate a case variant of a word: original, all-lower, all-upper,
 * or a random mixed-case permutation.
 */
function caseVariantArb(word: string): fc.Arbitrary<string> {
  return fc.constantFrom(
    word,                    // original
    word.toLowerCase(),      // all lower
    word.toUpperCase(),      // all upper
    // swap case of each character
    word
      .split('')
      .map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))
      .join(''),
  );
}

/**
 * Generate a line of content that contains a variant of the marker word.
 */
function lineWithVariantArb(marker: string): fc.Arbitrary<string> {
  return fc
    .tuple(fileSegmentArb, caseVariantArb(marker), fileSegmentArb)
    .map(([prefix, variant, suffix]) => `${prefix} ${variant} ${suffix}`);
}

/**
 * Generate a line of content that does NOT contain the marker in any case.
 */
function lineWithoutMarkerArb(marker: string): fc.Arbitrary<string> {
  const lowerMarker = marker.toLowerCase();
  return fileSegmentArb.filter(
    (w) => !w.toLowerCase().includes(lowerMarker),
  );
}

/**
 * Generate a complete test scenario:
 * - A mixed-case marker word to search for
 * - Multiple files with lines containing various case variants of the marker
 *   and lines without the marker
 */
const scenarioArb = fc
  .tuple(
    mixedCaseWordArb,
    fc.array(filePathArb, { minLength: 1, maxLength: 4 }),
  )
  .chain(([marker, rawPaths]) => {
    const paths = [...new Set(rawPaths)];
    if (paths.length === 0) return fc.constant(null);

    // For each file, generate a mix of lines with and without the marker
    const fileContentArb = fc
      .tuple(
        // Lines without marker (0-3)
        fc.array(lineWithoutMarkerArb(marker), {
          minLength: 0,
          maxLength: 3,
        }),
        // Line with exact marker (case-sensitive match)
        fc
          .tuple(fileSegmentArb, fileSegmentArb)
          .map(([pre, suf]) => `${pre} ${marker} ${suf}`),
        // Lines with case variants (0-3) — may or may not match case-sensitive
        fc.array(lineWithVariantArb(marker), {
          minLength: 0,
          maxLength: 3,
        }),
        // Lines without marker (0-2)
        fc.array(lineWithoutMarkerArb(marker), {
          minLength: 0,
          maxLength: 2,
        }),
      )
      .map(([before, exactLine, variantLines, after]) => ({
        content: [...before, exactLine, ...variantLines, ...after].join('\n'),
      }));

    return fc
      .tuple(
        fc.constant(marker),
        fc.constant(paths),
        fc.tuple(...paths.map(() => fileContentArb)),
      )
      .map(([m, p, contents]) => ({
        marker: m,
        files: p.map((filePath, i) => ({
          path: filePath,
          content: contents[i].content,
        })),
      }));
  })
  .filter((s): s is NonNullable<typeof s> => s !== null);

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 17: Case Sensitivity Metamorphic Property', () => {
  it('case-insensitive grep results are a superset of case-sensitive results for the same query', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const workspace = createTempWorkspace();
        const origEnv = process.env['CLOVER_WORKSPACE'];
        process.env['CLOVER_WORKSPACE'] = workspace;

        try {
          // Write all generated files
          for (const file of scenario.files) {
            writeFile(workspace, file.path, file.content);
          }

          // Use the marker as a literal regex query (escaped)
          const regexQuery = escapeRegex(scenario.marker);

          // Run case-sensitive search
          const sensitiveResult = await grepTextPlugin.execute(
            {
              query: regexQuery,
              caseSensitive: true,
              maxResults: 1000,
              offset: 0,
            },
            makeCtx(workspace),
          );

          // Run case-insensitive search
          const insensitiveResult = await grepTextPlugin.execute(
            {
              query: regexQuery,
              caseSensitive: false,
              maxResults: 1000,
              offset: 0,
            },
            makeCtx(workspace),
          );

          expect(sensitiveResult.success).toBe(true);
          expect(insensitiveResult.success).toBe(true);

          const sensitiveItems: Array<{
            filePath: string;
            lineNumber: number;
            matchLine: string;
          }> = JSON.parse(sensitiveResult.output).items;

          const insensitiveItems: Array<{
            filePath: string;
            lineNumber: number;
            matchLine: string;
          }> = JSON.parse(insensitiveResult.output).items;

          // Build a set of keys from the case-insensitive results
          const insensitiveKeys = new Set(
            insensitiveItems.map(matchKey),
          );

          // PROPERTY: Every case-sensitive result must also appear in
          // the case-insensitive results (superset property)
          for (const item of sensitiveItems) {
            const key = matchKey(item);
            expect(
              insensitiveKeys.has(key),
              `Case-sensitive match at ${key} should also appear in case-insensitive results. ` +
                `Case-sensitive found ${sensitiveItems.length} results, ` +
                `case-insensitive found ${insensitiveItems.length} results.`,
            ).toBe(true);
          }

          // PROPERTY: Case-insensitive results should be >= case-sensitive
          expect(insensitiveItems.length).toBeGreaterThanOrEqual(
            sensitiveItems.length,
          );
        } finally {
          if (origEnv === undefined) {
            delete process.env['CLOVER_WORKSPACE'];
          } else {
            process.env['CLOVER_WORKSPACE'] = origEnv;
          }
          fs.rmSync(workspace, { recursive: true, force: true });
          tempDirs.splice(tempDirs.indexOf(workspace), 1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('case-insensitive search finds additional matches when content has different casing than query', async () => {
    await fc.assert(
      fc.asyncProperty(mixedCaseWordArb, async (marker) => {
        const workspace = createTempWorkspace();
        const origEnv = process.env['CLOVER_WORKSPACE'];
        process.env['CLOVER_WORKSPACE'] = workspace;

        try {
          // Create a file with three lines:
          // 1. Exact case match
          // 2. All-uppercase variant
          // 3. All-lowercase variant
          const exactLine = `prefix ${marker} suffix`;
          const upperLine = `prefix ${marker.toUpperCase()} suffix`;
          const lowerLine = `prefix ${marker.toLowerCase()} suffix`;
          const content = [exactLine, upperLine, lowerLine].join('\n');

          writeFile(workspace, 'test.txt', content);

          const regexQuery = escapeRegex(marker);

          // Case-sensitive search
          const sensitiveResult = await grepTextPlugin.execute(
            {
              query: regexQuery,
              caseSensitive: true,
              maxResults: 1000,
              offset: 0,
            },
            makeCtx(workspace),
          );

          // Case-insensitive search
          const insensitiveResult = await grepTextPlugin.execute(
            {
              query: regexQuery,
              caseSensitive: false,
              maxResults: 1000,
              offset: 0,
            },
            makeCtx(workspace),
          );

          expect(sensitiveResult.success).toBe(true);
          expect(insensitiveResult.success).toBe(true);

          const sensitiveItems: Array<{
            filePath: string;
            lineNumber: number;
          }> = JSON.parse(sensitiveResult.output).items;

          const insensitiveItems: Array<{
            filePath: string;
            lineNumber: number;
          }> = JSON.parse(insensitiveResult.output).items;

          // Case-insensitive should find all three lines
          // (exact, upper, lower all match case-insensitively)
          expect(insensitiveItems.length).toBe(3);

          // Case-insensitive results must be >= case-sensitive results
          expect(insensitiveItems.length).toBeGreaterThanOrEqual(
            sensitiveItems.length,
          );

          // Superset property: every case-sensitive match is in
          // case-insensitive results
          const insensitiveKeys = new Set(
            insensitiveItems.map(matchKey),
          );
          for (const item of sensitiveItems) {
            expect(insensitiveKeys.has(matchKey(item))).toBe(true);
          }
        } finally {
          if (origEnv === undefined) {
            delete process.env['CLOVER_WORKSPACE'];
          } else {
            process.env['CLOVER_WORKSPACE'] = origEnv;
          }
          fs.rmSync(workspace, { recursive: true, force: true });
          tempDirs.splice(tempDirs.indexOf(workspace), 1);
        }
      }),
      { numRuns: 100 },
    );
  });
});
