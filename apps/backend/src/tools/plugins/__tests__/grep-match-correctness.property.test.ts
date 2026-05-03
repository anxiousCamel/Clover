/**
 * Property-Based Test — Property 16: Grep Results Contain Regex Match
 *
 * **Validates: Requirements 4.2.2**
 *
 * For any regex query and for any file in the workspace, every result
 * returned by `grep-text` SHALL contain a line that matches the regex
 * at the reported line number in the reported file path.
 *
 * Generator strategy:
 *   - Generate files with known multi-line content.
 *   - Derive a regex pattern from a substring of the content (escaping
 *     regex special characters).
 *   - Run grep-text against the temp workspace.
 *   - For every result, read the actual file and verify:
 *       a) The reported file path exists.
 *       b) The reported line number has content matching the regex.
 *       c) The matchLine field equals the actual line at that position.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clover-grep-match-'));
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
 * Escape regex special characters in a string so it can be used as a
 * literal pattern in a RegExp.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize a path to use forward slashes for cross-platform consistency.
 */
function normalizePath(p: string): string {
  return p.split(path.sep).join('/');
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
 * Generate a "word" that is safe for embedding in file content and
 * deriving a regex from. Uses alphanumeric chars only.
 */
const safeWordArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{2,12}$/);

/**
 * Generate a line of content containing a known marker word surrounded
 * by other text.
 */
const lineWithMarkerArb = (marker: string) =>
  fc
    .tuple(safeWordArb, safeWordArb)
    .map(([prefix, suffix]) => `${prefix} ${marker} ${suffix}`);

/**
 * Generate a line of content that does NOT contain the marker.
 */
const lineWithoutMarkerArb = (marker: string) =>
  safeWordArb.filter((w) => !w.includes(marker));

/**
 * Generate a multi-line file content where the marker appears on at
 * least one known line. Returns the content string and the set of
 * 1-based line numbers where the marker appears.
 */
const fileContentArb = (marker: string) =>
  fc
    .tuple(
      // Lines before the marker (0-4 lines without marker)
      fc.array(lineWithoutMarkerArb(marker), { minLength: 0, maxLength: 4 }),
      // The marker line
      lineWithMarkerArb(marker),
      // Lines after the marker (0-4 lines without marker)
      fc.array(lineWithoutMarkerArb(marker), { minLength: 0, maxLength: 4 }),
    )
    .map(([before, markerLine, after]) => {
      const lines = [...before, markerLine, ...after];
      const markerLineNumbers = [before.length + 1]; // 1-based
      return { content: lines.join('\n'), markerLineNumbers };
    });

/**
 * Generate a complete test scenario:
 * - A unique marker word to search for
 * - Multiple files, each with known content and known marker positions
 */
const scenarioArb = fc
  .tuple(
    safeWordArb,
    fc.array(filePathArb, { minLength: 1, maxLength: 5 }),
  )
  .chain(([marker, rawPaths]) => {
    // Deduplicate paths
    const paths = [...new Set(rawPaths)];
    if (paths.length === 0) return fc.constant(null);

    return fc
      .tuple(
        fc.constant(marker),
        fc.constant(paths),
        // For each file, generate content with the marker
        fc.tuple(...paths.map(() => fileContentArb(marker))),
      )
      .map(([m, p, contents]) => ({
        marker: m,
        files: p.map((filePath, i) => ({
          path: filePath,
          content: contents[i].content,
          markerLineNumbers: contents[i].markerLineNumbers,
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

describe('Property 16: Grep Results Contain Regex Match', () => {
  it('every grep-text result line matches the regex at the reported line number and file path', async () => {
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

          // Derive a regex from the marker (escaped for literal matching)
          const regexQuery = escapeRegex(scenario.marker);

          const result = await grepTextPlugin.execute(
            {
              query: regexQuery,
              caseSensitive: true,
              maxResults: 1000,
              offset: 0,
            },
            makeCtx(workspace),
          );

          expect(result.success).toBe(true);
          const parsed = JSON.parse(result.output);
          const items: Array<{
            filePath: string;
            lineNumber: number;
            matchLine: string;
            contextBefore: string[];
            contextAfter: string[];
          }> = parsed.items;

          // Build a regex to verify matches
          const verifyRegex = new RegExp(regexQuery);

          for (const item of items) {
            const normalizedItemPath = normalizePath(item.filePath);

            // 1. The reported file path must exist in the workspace
            const absPath = path.join(workspace, item.filePath);
            expect(
              fs.existsSync(absPath),
              `Reported file path should exist: ${item.filePath}`,
            ).toBe(true);

            // 2. Read the actual file and get the line at the reported number
            const actualContent = fs.readFileSync(absPath, 'utf-8');
            const actualLines = actualContent.split(/\r?\n/);
            const lineIndex = item.lineNumber - 1; // convert to 0-based

            expect(
              lineIndex >= 0 && lineIndex < actualLines.length,
              `Line number ${item.lineNumber} should be within file bounds (1-${actualLines.length})`,
            ).toBe(true);

            const actualLine = actualLines[lineIndex];

            // 3. The matchLine field must equal the actual line at that position
            expect(item.matchLine).toBe(actualLine);

            // 4. The actual line must match the regex
            expect(
              verifyRegex.test(actualLine),
              `Line ${item.lineNumber} in ${normalizedItemPath} should match regex "${regexQuery}". Actual: "${actualLine}"`,
            ).toBe(true);
          }

          // 5. Verify completeness: every file's marker lines are represented
          for (const file of scenario.files) {
            const normalizedFilePath = normalizePath(file.path);
            for (const expectedLineNum of file.markerLineNumbers) {
              const found = items.some(
                (item) =>
                  normalizePath(item.filePath) === normalizedFilePath &&
                  item.lineNumber === expectedLineNum,
              );
              expect(
                found,
                `Expected match at ${normalizedFilePath}:${expectedLineNum} for marker "${scenario.marker}"`,
              ).toBe(true);
            }
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

  it('grep-text with case-insensitive search still reports correct line numbers and content', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const workspace = createTempWorkspace();
        const origEnv = process.env['CLOVER_WORKSPACE'];
        process.env['CLOVER_WORKSPACE'] = workspace;

        try {
          // Write files
          for (const file of scenario.files) {
            writeFile(workspace, file.path, file.content);
          }

          const regexQuery = escapeRegex(scenario.marker);

          const result = await grepTextPlugin.execute(
            {
              query: regexQuery,
              caseSensitive: false,
              maxResults: 1000,
              offset: 0,
            },
            makeCtx(workspace),
          );

          expect(result.success).toBe(true);
          const parsed = JSON.parse(result.output);
          const items: Array<{
            filePath: string;
            lineNumber: number;
            matchLine: string;
          }> = parsed.items;

          const verifyRegex = new RegExp(regexQuery, 'i');

          for (const item of items) {
            // The reported file must exist
            const absPath = path.join(workspace, item.filePath);
            expect(fs.existsSync(absPath)).toBe(true);

            // Read actual file and verify line content
            const actualContent = fs.readFileSync(absPath, 'utf-8');
            const actualLines = actualContent.split(/\r?\n/);
            const lineIndex = item.lineNumber - 1;

            expect(lineIndex >= 0 && lineIndex < actualLines.length).toBe(
              true,
            );

            // matchLine must equal the actual line
            expect(item.matchLine).toBe(actualLines[lineIndex]);

            // The line must match the regex (case-insensitive)
            expect(verifyRegex.test(actualLines[lineIndex])).toBe(true);
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
