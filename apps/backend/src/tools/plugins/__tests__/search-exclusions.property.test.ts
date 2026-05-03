/**
 * Property-Based Test — Property 15: Search Results Match Pattern and Respect Exclusions
 *
 * **Validates: Requirements 4.1.2, 4.1.3, 4.2.4**
 *
 * For any glob pattern and for any workspace file tree, every path returned
 * by `search-files` SHALL match the glob pattern, SHALL be relative to
 * workspace root, and SHALL NOT be inside `node_modules`, `.git`, or any
 * `.gitignore`-listed directory. The same exclusion invariant applies to
 * `grep-text` results.
 *
 * Generator strategy:
 *   - Generate file trees with a mix of normal paths and paths inside
 *     excluded directories (node_modules, .git, gitignore-listed).
 *   - Create a temp workspace with those files.
 *   - Run search-files and grep-text against the workspace.
 *   - Verify all results match the glob and none are in excluded dirs.
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

/** Directories that should always be excluded from search results. */
const ALWAYS_EXCLUDED_DIRS = ['node_modules', '.git'];

/** Unique content marker embedded in every generated file for grep testing. */
const GREP_MARKER = 'SEARCH_MARKER_CONTENT';

/** Track temp dirs for cleanup. */
const tempDirs: string[] = [];

/** Create a temporary workspace directory. */
function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clover-search-test-'));
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
 * Check whether a relative path is inside a given directory name.
 * A path like "node_modules/foo/bar.ts" is inside "node_modules".
 * Uses forward-slash normalization for cross-platform consistency.
 */
function isInsideDir(relPath: string, dirName: string): boolean {
  const normalized = normalizePath(relPath);
  return (
    normalized === dirName ||
    normalized.startsWith(`${dirName}/`) ||
    normalized.includes(`/${dirName}/`)
  );
}

/**
 * Simple glob-like check for extension patterns (e.g., "**\/*.ts").
 * For the `**\/*` wildcard pattern, everything matches.
 */
function matchesGlob(filePath: string, pattern: string): boolean {
  if (pattern === '**/*') return true;

  // Handle **/*.ext patterns
  const extMatch = pattern.match(/^\*\*\/\*(\.\w+)$/);
  if (extMatch) {
    return filePath.endsWith(extMatch[1]);
  }

  return true; // conservative: don't reject unknown patterns
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a safe filename segment (lowercase alphanumeric, 1-8 chars). */
const fileSegmentArb = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/);

/** Generate a file extension. */
const extensionArb = fc.constantFrom('.ts', '.js', '.json', '.md', '.txt');

/**
 * Generate a normal (non-excluded) relative file path with 0-2 directory
 * depth. Directory names are chosen to never collide with excluded dirs.
 */
const normalPathArb = fc
  .tuple(
    fc.array(
      fileSegmentArb.filter(
        (s) => s !== 'node_modules' && s !== 'git' && s !== '.git',
      ),
      { minLength: 0, maxLength: 2 },
    ),
    fileSegmentArb,
    extensionArb,
  )
  .map(([dirs, name, ext]) => [...dirs, `${name}${ext}`].join('/'));

/** Generate a path inside node_modules. */
const nodeModulesPathArb = fc
  .tuple(fileSegmentArb, fileSegmentArb, extensionArb)
  .map(([pkg, name, ext]) => `node_modules/${pkg}/${name}${ext}`);

/** Generate a path inside .git. */
const gitPathArb = fc
  .tuple(fileSegmentArb, extensionArb)
  .map(([name, ext]) => `.git/${name}${ext}`);

/**
 * Generate a gitignore-excluded directory name that is distinct from
 * node_modules, .git, and common source directory names.
 */
const gitignoreDirArb = fc
  .stringMatching(/^[a-z]{4,8}$/)
  .filter(
    (d) =>
      d !== 'node' &&
      d !== 'git' &&
      d !== 'src' &&
      d !== 'apps' &&
      d !== 'test',
  );

/**
 * Generate a complete file tree specification:
 * - normalFiles: paths that should appear in results
 * - excludedFiles: paths in node_modules, .git, or gitignore dirs
 * - gitignoreDirs: custom directory names listed in .gitignore
 */
const fileTreeArb = fc
  .tuple(
    // Normal files (1-6)
    fc.array(normalPathArb, { minLength: 1, maxLength: 6 }),
    // node_modules files (0-3)
    fc.array(nodeModulesPathArb, { minLength: 0, maxLength: 3 }),
    // .git files (0-2)
    fc.array(gitPathArb, { minLength: 0, maxLength: 2 }),
    // gitignore directory name
    gitignoreDirArb,
    // files inside gitignore dir (0-3)
    fc.array(fileSegmentArb, { minLength: 0, maxLength: 3 }),
  )
  .map(([normalFiles, nmFiles, gitFiles, giDir, giFileNames]) => {
    const gitignoreFiles = giFileNames.map((name) => `${giDir}/${name}.ts`);
    return {
      normalFiles: [...new Set(normalFiles)],
      excludedFiles: [
        ...new Set([...nmFiles, ...gitFiles, ...gitignoreFiles]),
      ],
      gitignoreDirs: gitignoreFiles.length > 0 ? [giDir] : [],
    };
  });

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

describe('Property 15: Search Results Match Pattern and Respect Exclusions', () => {
  // -------------------------------------------------------------------------
  // search-files: all results match glob and none are in excluded dirs
  // -------------------------------------------------------------------------
  it('search-files results match glob pattern and exclude node_modules, .git, and .gitignore dirs', async () => {
    await fc.assert(
      fc.asyncProperty(fileTreeArb, async (tree) => {
        const workspace = createTempWorkspace();
        const origEnv = process.env['CLOVER_WORKSPACE'];
        process.env['CLOVER_WORKSPACE'] = workspace;

        try {
          // Write all files
          for (const relPath of tree.normalFiles) {
            writeFile(workspace, relPath, `${GREP_MARKER} normal content`);
          }
          for (const relPath of tree.excludedFiles) {
            writeFile(workspace, relPath, `${GREP_MARKER} excluded content`);
          }

          // Write .gitignore if there are custom excluded dirs
          if (tree.gitignoreDirs.length > 0) {
            writeFile(
              workspace,
              '.gitignore',
              tree.gitignoreDirs.join('\n') + '\n',
            );
          }

          const result = await searchFilesPlugin.execute(
            { pattern: '**/*', maxResults: 1000, offset: 0 },
            makeCtx(workspace),
          );

          expect(result.success).toBe(true);
          const parsed = JSON.parse(result.output);
          const items: string[] = (parsed.items as string[]).map(normalizePath);

          // Property: Every returned path matches the glob pattern
          for (const item of items) {
            expect(matchesGlob(item, '**/*')).toBe(true);
          }

          // Property: No result is inside node_modules or .git
          for (const item of items) {
            for (const excluded of ALWAYS_EXCLUDED_DIRS) {
              expect(isInsideDir(item, excluded)).toBe(false);
            }
          }

          // Property: No result is inside .gitignore-listed directories
          for (const item of items) {
            for (const giDir of tree.gitignoreDirs) {
              expect(isInsideDir(item, giDir)).toBe(false);
            }
          }

          // Property: All normal files (not in excluded dirs) ARE in results
          for (const normalFile of tree.normalFiles) {
            const inExcluded =
              ALWAYS_EXCLUDED_DIRS.some((d) => isInsideDir(normalFile, d)) ||
              tree.gitignoreDirs.some((d) => isInsideDir(normalFile, d));
            if (!inExcluded) {
              expect(items).toContain(normalizePath(normalFile));
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

  // -------------------------------------------------------------------------
  // search-files: specific glob patterns still respect exclusions
  // -------------------------------------------------------------------------
  it('search-files with extension glob excludes node_modules, .git, and .gitignore dirs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fileTreeArb,
        fc.constantFrom('**/*.ts', '**/*.js', '**/*.json', '**/*.md'),
        async (tree, globPattern) => {
          const workspace = createTempWorkspace();
          const origEnv = process.env['CLOVER_WORKSPACE'];
          process.env['CLOVER_WORKSPACE'] = workspace;

          try {
            for (const relPath of tree.normalFiles) {
              writeFile(workspace, relPath, `${GREP_MARKER} content`);
            }
            for (const relPath of tree.excludedFiles) {
              writeFile(workspace, relPath, `${GREP_MARKER} content`);
            }
            if (tree.gitignoreDirs.length > 0) {
              writeFile(
                workspace,
                '.gitignore',
                tree.gitignoreDirs.join('\n') + '\n',
              );
            }

            const result = await searchFilesPlugin.execute(
              { pattern: globPattern, maxResults: 1000, offset: 0 },
              makeCtx(workspace),
            );

            expect(result.success).toBe(true);
            const parsed = JSON.parse(result.output);
            const items: string[] = (parsed.items as string[]).map(normalizePath);

            // Every result matches the glob pattern
            for (const item of items) {
              expect(matchesGlob(item, globPattern)).toBe(true);
            }

            // No result is in excluded directories
            for (const item of items) {
              for (const excluded of ALWAYS_EXCLUDED_DIRS) {
                expect(isInsideDir(item, excluded)).toBe(false);
              }
              for (const giDir of tree.gitignoreDirs) {
                expect(isInsideDir(item, giDir)).toBe(false);
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
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // grep-text: same exclusion invariant applies
  // -------------------------------------------------------------------------
  it('grep-text results exclude node_modules, .git, and .gitignore-listed dirs', async () => {
    await fc.assert(
      fc.asyncProperty(fileTreeArb, async (tree) => {
        const workspace = createTempWorkspace();
        const origEnv = process.env['CLOVER_WORKSPACE'];
        process.env['CLOVER_WORKSPACE'] = workspace;

        try {
          // Write all files with the grep marker
          for (const relPath of tree.normalFiles) {
            writeFile(workspace, relPath, `line1\n${GREP_MARKER}\nline3`);
          }
          for (const relPath of tree.excludedFiles) {
            writeFile(workspace, relPath, `line1\n${GREP_MARKER}\nline3`);
          }
          if (tree.gitignoreDirs.length > 0) {
            writeFile(
              workspace,
              '.gitignore',
              tree.gitignoreDirs.join('\n') + '\n',
            );
          }

          const result = await grepTextPlugin.execute(
            {
              query: GREP_MARKER,
              caseSensitive: true,
              maxResults: 1000,
              offset: 0,
            },
            makeCtx(workspace),
          );

          expect(result.success).toBe(true);
          const parsed = JSON.parse(result.output);
          const items: Array<{ filePath: string; matchLine: string }> =
            (parsed.items as Array<{ filePath: string; matchLine: string }>).map(
              (item) => ({ ...item, filePath: normalizePath(item.filePath) }),
            );

          // Every result's matchLine contains the grep marker
          for (const item of items) {
            expect(item.matchLine).toContain(GREP_MARKER);
          }

          // No result is inside node_modules or .git
          for (const item of items) {
            for (const excluded of ALWAYS_EXCLUDED_DIRS) {
              expect(isInsideDir(item.filePath, excluded)).toBe(false);
            }
          }

          // No result is inside .gitignore-listed directories
          for (const item of items) {
            for (const giDir of tree.gitignoreDirs) {
              expect(isInsideDir(item.filePath, giDir)).toBe(false);
            }
          }

          // All normal files (not in excluded dirs) should have matches
          for (const normalFile of tree.normalFiles) {
            const inExcluded =
              ALWAYS_EXCLUDED_DIRS.some((d) =>
                isInsideDir(normalFile, d),
              ) ||
              tree.gitignoreDirs.some((d) => isInsideDir(normalFile, d));
            if (!inExcluded) {
              const found = items.some(
                (m) => m.filePath === normalizePath(normalFile),
              );
              expect(found).toBe(true);
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
});
