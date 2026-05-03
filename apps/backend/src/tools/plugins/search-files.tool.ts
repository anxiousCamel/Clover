/**
 * Search-Files Tool Plugin — glob-based file search within the workspace.
 *
 * Accepts a glob pattern and returns matching file paths relative to the
 * workspace root. Automatically excludes `node_modules`, `.git`, and any
 * directories listed in the workspace's `.gitignore`.
 *
 * Results are paginated via `maxResults` and `offset` parameters.
 * Never requires user confirmation (read-only operation).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import { z } from 'zod';
import type { ToolPlugin, ToolContext, ToolResult } from '@clover/shared';
import { InvalidGlobError } from '../../errors/search-errors.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  pattern: z.string().min(1, 'pattern is required'),
  maxResults: z.number().int().min(1).default(100),
  offset: z.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  totalCount: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directories excluded from every search by default. */
const DEFAULT_IGNORE = ['**/node_modules/**', '**/.git/**'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the workspace `.gitignore` and convert each non-comment, non-empty
 * line into a glob ignore pattern.  Returns an empty array when the file
 * does not exist or cannot be read.
 */
async function loadGitignorePatterns(workspacePath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(
      path.join(workspacePath, '.gitignore'),
      'utf-8',
    );

    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((entry) => {
        // Strip leading slash — gitignore "/dist" means repo-root-relative
        const cleaned = entry.startsWith('/') ? entry.slice(1) : entry;
        // If the pattern doesn't already contain a glob wildcard for
        // directory contents, wrap it so `glob` ignores the whole tree.
        if (cleaned.endsWith('/')) {
          return `**/${cleaned}**`;
        }
        return `**/${cleaned}/**`;
      });
  } catch {
    // .gitignore missing or unreadable — not an error
    return [];
  }
}

/**
 * Paginate an array of items.
 */
function paginate<T>(
  items: T[],
  offset: number,
  maxResults: number,
): PaginatedResult<T> {
  const totalCount = items.length;
  const page = items.slice(offset, offset + maxResults);

  return {
    items: page,
    hasMore: offset + maxResults < totalCount,
    totalCount,
    offset,
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: 'search-files',
  description:
    'Search for files in the workspace using a glob pattern. Returns matching file paths with pagination support. Automatically excludes node_modules, .git, and .gitignore-listed directories.',
  inputSchema,

  requiresConfirmation: () => false,

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { pattern, maxResults, offset } = inputSchema.parse(args);

    const workspacePath =
      process.env['CLOVER_WORKSPACE'] ?? ctx.workspacePath;

    // Build the ignore list: defaults + .gitignore entries
    const gitignorePatterns = await loadGitignorePatterns(workspacePath);
    const ignore = [...DEFAULT_IGNORE, ...gitignorePatterns];

    try {
      const matches = await glob(pattern, {
        cwd: workspacePath,
        nodir: true,
        dot: true,
        ignore,
        windowsPathsNoEscape: true,
      });

      // Sort for deterministic output
      matches.sort();

      const result = paginate(matches, offset, maxResults);

      return {
        success: true,
        output: JSON.stringify(result),
      };
    } catch (err: unknown) {
      // The glob library throws on invalid patterns
      const message =
        err instanceof Error ? err.message : 'Unknown glob error';
      throw new InvalidGlobError(pattern, message);
    }
  },
};

export default plugin;
