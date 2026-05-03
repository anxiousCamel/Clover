/**
 * Property-Based Test — Property 18: Search Pagination Correctness
 *
 * **Validates: Requirements 4.1.4, 4.2.5, 4.3.1, 4.3.2**
 *
 * For any search query with total matches T and configured `maxResults` M,
 * when T > M the response SHALL have `hasMore: true`, `totalCount: T`, and
 * `items.length ≤ M`. Requesting with `offset: M` SHALL return the next
 * page of results with no overlap with the first page.
 *
 * Generator strategy:
 *   - Generate result sets of size 1–500 by creating temp workspaces with
 *     that many files.
 *   - Vary `maxResults` to exercise pagination boundaries.
 *   - Verify `hasMore`, `totalCount`, page size, and no overlap between
 *     consecutive pages.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import searchFilesPlugin from '../search-files.tool.js';
import grepTextPlugin from '../grep-text.tool.js';
import type { ToolContext } from '@clover/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Track temp dirs for cleanup. */
const tempDirs: string[] = [];

/** Create a temporary workspace directory. */
function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clover-pagination-test-'));
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
 * Write N files into the workspace, each with a unique name and a known
 * content marker for grep testing.
 */
function populateWorkspace(workspacePath: string, fileCount: number): void {
  for (let i = 0; i < fileCount; i++) {
    const relPath = `file-${String(i).padStart(4, '0')}.ts`;
    const absPath = path.join(workspacePath, relPath);
    fs.writeFileSync(absPath, `PAGINATION_MARKER line ${i}\n`, 'utf-8');
  }
}

/** Parse a paginated result from a ToolResult output string. */
function parsePaginated<T>(output: string): {
  items: T[];
  hasMore: boolean;
  totalCount: number;
  offset: number;
  summary?: string;
} {
  return JSON.parse(output);
}

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

describe('Property 18: Search Pagination Correctness', () => {
  // -------------------------------------------------------------------------
  // search-files: hasMore, totalCount, and page size correctness
  // -------------------------------------------------------------------------
  it(
    'search-files: when results exceed maxResults, hasMore is true, totalCount equals total, and items.length ≤ maxResults',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // fileCount: 1–150 (kept moderate for speed)
          fc.integer({ min: 1, max: 150 }),
          // maxResults: 1–100
          fc.integer({ min: 1, max: 100 }),
          async (fileCount, maxResults) => {
            const workspace = createTempWorkspace();
            const origEnv = process.env['CLOVER_WORKSPACE'];
            process.env['CLOVER_WORKSPACE'] = workspace;

            try {
              populateWorkspace(workspace, fileCount);

              const result = await searchFilesPlugin.execute(
                { pattern: '**/*.ts', maxResults, offset: 0 },
                makeCtx(workspace),
              );

              expect(result.success).toBe(true);
              const page = parsePaginated<string>(result.output);

              // totalCount equals the actual number of files created
              expect(page.totalCount).toBe(fileCount);

              // items.length never exceeds maxResults
              expect(page.items.length).toBeLessThanOrEqual(maxResults);

              // items.length is min(maxResults, totalCount) for first page
              expect(page.items.length).toBe(Math.min(maxResults, fileCount));

              // hasMore correctness
              if (fileCount > maxResults) {
                expect(page.hasMore).toBe(true);
              } else {
                expect(page.hasMore).toBe(false);
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
          },
        ),
        { numRuns: 100 },
      );
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  // search-files: consecutive pages have no overlap and are complete
  // -------------------------------------------------------------------------
  it(
    'search-files: consecutive pages have no overlap and cover all results',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // fileCount: 2–100 (need at least 2 to have multiple pages)
          fc.integer({ min: 2, max: 100 }),
          // maxResults: 1–50 (ensure pagination happens often)
          fc.integer({ min: 1, max: 50 }),
          async (fileCount, maxResults) => {
            const workspace = createTempWorkspace();
            const origEnv = process.env['CLOVER_WORKSPACE'];
            process.env['CLOVER_WORKSPACE'] = workspace;

            try {
              populateWorkspace(workspace, fileCount);

              // Collect all pages
              const allItems: string[] = [];
              let currentOffset = 0;
              let hasMore = true;
              let reportedTotal: number | undefined;

              while (hasMore) {
                const result = await searchFilesPlugin.execute(
                  {
                    pattern: '**/*.ts',
                    maxResults,
                    offset: currentOffset,
                  },
                  makeCtx(workspace),
                );
                expect(result.success).toBe(true);
                const page = parsePaginated<string>(result.output);

                // Every page reports the same totalCount
                if (reportedTotal === undefined) {
                  reportedTotal = page.totalCount;
                } else {
                  expect(page.totalCount).toBe(reportedTotal);
                }

                // Page size never exceeds maxResults
                expect(page.items.length).toBeLessThanOrEqual(maxResults);

                allItems.push(...page.items);
                hasMore = page.hasMore;
                currentOffset += maxResults;
              }

              // totalCount matches actual file count
              expect(reportedTotal).toBe(fileCount);

              // All pages combined should equal totalCount
              expect(allItems.length).toBe(fileCount);

              // No duplicates across all pages
              const allSet = new Set(allItems);
              expect(allSet.size).toBe(allItems.length);
            } finally {
              if (origEnv === undefined) {
                delete process.env['CLOVER_WORKSPACE'];
              } else {
                process.env['CLOVER_WORKSPACE'] = origEnv;
              }
              fs.rmSync(workspace, { recursive: true, force: true });
              tempDirs.splice(tempDirs.indexOf(workspace), 1);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  // grep-text: hasMore, totalCount, and page size correctness
  // -------------------------------------------------------------------------
  it(
    'grep-text: when results exceed maxResults, hasMore is true, totalCount equals total, and items.length ≤ maxResults',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // fileCount: 1–150
          fc.integer({ min: 1, max: 150 }),
          // maxResults: 1–100
          fc.integer({ min: 1, max: 100 }),
          async (fileCount, maxResults) => {
            const workspace = createTempWorkspace();
            const origEnv = process.env['CLOVER_WORKSPACE'];
            process.env['CLOVER_WORKSPACE'] = workspace;

            try {
              populateWorkspace(workspace, fileCount);

              const result = await grepTextPlugin.execute(
                {
                  query: 'PAGINATION_MARKER',
                  includePattern: '**/*.ts',
                  caseSensitive: true,
                  maxResults,
                  offset: 0,
                },
                makeCtx(workspace),
              );

              expect(result.success).toBe(true);
              const page = parsePaginated<{
                filePath: string;
                lineNumber: number;
                matchLine: string;
              }>(result.output);

              // Each file has exactly one matching line, so totalCount == fileCount
              expect(page.totalCount).toBe(fileCount);

              // items.length never exceeds maxResults
              expect(page.items.length).toBeLessThanOrEqual(maxResults);

              // items.length is min(maxResults, totalCount) for first page
              expect(page.items.length).toBe(Math.min(maxResults, fileCount));

              // hasMore correctness
              if (fileCount > maxResults) {
                expect(page.hasMore).toBe(true);
              } else {
                expect(page.hasMore).toBe(false);
              }

              // When hasMore is true, summary should be present
              if (page.hasMore) {
                expect(page.summary).toBeDefined();
                expect(page.summary).toContain('of');
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
          },
        ),
        { numRuns: 100 },
      );
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  // grep-text: consecutive pages have no overlap and are complete
  // -------------------------------------------------------------------------
  it(
    'grep-text: consecutive pages have no overlap and cover all results',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // fileCount: 2–100
          fc.integer({ min: 2, max: 100 }),
          // maxResults: 1–50
          fc.integer({ min: 1, max: 50 }),
          async (fileCount, maxResults) => {
            const workspace = createTempWorkspace();
            const origEnv = process.env['CLOVER_WORKSPACE'];
            process.env['CLOVER_WORKSPACE'] = workspace;

            try {
              populateWorkspace(workspace, fileCount);

              // Collect all pages
              const allPaths: string[] = [];
              let currentOffset = 0;
              let hasMore = true;
              let reportedTotal: number | undefined;

              while (hasMore) {
                const result = await grepTextPlugin.execute(
                  {
                    query: 'PAGINATION_MARKER',
                    includePattern: '**/*.ts',
                    caseSensitive: true,
                    maxResults,
                    offset: currentOffset,
                  },
                  makeCtx(workspace),
                );
                expect(result.success).toBe(true);
                const page = parsePaginated<{ filePath: string }>(
                  result.output,
                );

                // Every page reports the same totalCount
                if (reportedTotal === undefined) {
                  reportedTotal = page.totalCount;
                } else {
                  expect(page.totalCount).toBe(reportedTotal);
                }

                // Page size never exceeds maxResults
                expect(page.items.length).toBeLessThanOrEqual(maxResults);

                allPaths.push(...page.items.map((i) => i.filePath));
                hasMore = page.hasMore;
                currentOffset += maxResults;
              }

              // totalCount matches actual file count
              expect(reportedTotal).toBe(fileCount);

              // All pages combined should equal totalCount
              expect(allPaths.length).toBe(fileCount);

              // No duplicates across all pages
              const allSet = new Set(allPaths);
              expect(allSet.size).toBe(allPaths.length);
            } finally {
              if (origEnv === undefined) {
                delete process.env['CLOVER_WORKSPACE'];
              } else {
                process.env['CLOVER_WORKSPACE'] = origEnv;
              }
              fs.rmSync(workspace, { recursive: true, force: true });
              tempDirs.splice(tempDirs.indexOf(workspace), 1);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
    120_000,
  );
});
