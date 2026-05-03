/**
 * Grep-Text Tool Plugin — regex content search within the workspace.
 *
 * Accepts a regex pattern and returns matching lines with file path,
 * line number, and surrounding context (2 lines before/after).
 * Automatically excludes `node_modules`, `.git`, binary files, and any
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
import { InvalidRegexError } from '../../errors/search-errors.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  query: z.string().min(1, 'query is required'),
  includePattern: z.string().optional(),
  caseSensitive: z.boolean().default(false),
  maxResults: z.number().int().min(1).default(50),
  offset: z.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GrepMatch {
  filePath: string;
  lineNumber: number;
  matchLine: string;
  contextBefore: string[];
  contextAfter: string[];
}

interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  totalCount: number;
  offset: number;
  summary?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directories excluded from every search by default. */
const DEFAULT_IGNORE = ['**/node_modules/**', '**/.git/**'];

/** Number of context lines to include before and after each match. */
const CONTEXT_LINES = 2;

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
 * Detect whether a buffer likely contains binary content by checking
 * for null bytes in the first 512 bytes.
 */
function isBinaryContent(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 512);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Validate a regex pattern string. Throws `InvalidRegexError` if invalid.
 */
function buildRegex(pattern: string, caseSensitive: boolean): RegExp {
  try {
    const flags = caseSensitive ? '' : 'i';
    return new RegExp(pattern, flags);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown regex error';
    throw new InvalidRegexError(pattern, message);
  }
}

/**
 * Search a single file's content for regex matches and return GrepMatch
 * objects with surrounding context lines.
 */
function searchFileContent(
  filePath: string,
  lines: string[],
  regex: RegExp,
): GrepMatch[] {
  const matches: GrepMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      const contextBefore: string[] = [];
      const contextAfter: string[] = [];

      // Collect context before
      for (let b = Math.max(0, i - CONTEXT_LINES); b < i; b++) {
        contextBefore.push(lines[b]);
      }

      // Collect context after
      for (
        let a = i + 1;
        a <= Math.min(lines.length - 1, i + CONTEXT_LINES);
        a++
      ) {
        contextAfter.push(lines[a]);
      }

      matches.push({
        filePath,
        lineNumber: i + 1, // 1-based line numbers
        matchLine: lines[i],
        contextBefore,
        contextAfter,
      });
    }
  }

  return matches;
}

/**
 * Paginate an array of items with an optional summary for truncated results.
 */
function paginate<T>(
  items: T[],
  offset: number,
  maxResults: number,
): PaginatedResult<T> {
  const totalCount = items.length;
  const page = items.slice(offset, offset + maxResults);
  const hasMore = offset + maxResults < totalCount;

  const result: PaginatedResult<T> = {
    items: page,
    hasMore,
    totalCount,
    offset,
  };

  if (hasMore) {
    result.summary = `Showing ${page.length} of ${totalCount} results`;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: 'grep-text',
  description:
    'Search file contents in the workspace using a regex pattern. Returns matching lines with file path, line number, and surrounding context. Supports case-sensitive/insensitive search, glob-based file filtering, and pagination. Automatically excludes binary files, node_modules, .git, and .gitignore-listed directories.',
  inputSchema,

  requiresConfirmation: () => false,

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { query, includePattern, caseSensitive, maxResults, offset } =
      inputSchema.parse(args);

    const workspacePath =
      process.env['CLOVER_WORKSPACE'] ?? ctx.workspacePath;

    // Validate and build the regex
    const regex = buildRegex(query, caseSensitive);

    // Build the ignore list: defaults + .gitignore entries
    const gitignorePatterns = await loadGitignorePatterns(workspacePath);
    const ignore = [...DEFAULT_IGNORE, ...gitignorePatterns];

    // Determine the glob pattern for file discovery
    const filePattern = includePattern ?? '**/*';

    // Find all candidate files
    let filePaths: string[];
    try {
      filePaths = await glob(filePattern, {
        cwd: workspacePath,
        nodir: true,
        dot: true,
        ignore,
        windowsPathsNoEscape: true,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown glob error';
      return {
        success: false,
        output: '',
        error: `Invalid include pattern "${includePattern}": ${message}`,
      };
    }

    // Sort for deterministic output
    filePaths.sort();

    // Search each file for matches
    const allMatches: GrepMatch[] = [];

    for (const relPath of filePaths) {
      const absPath = path.join(workspacePath, relPath);

      try {
        // Read file as buffer first to check for binary content
        const buffer = await fs.readFile(absPath);

        if (isBinaryContent(buffer)) {
          continue;
        }

        const content = buffer.toString('utf-8');
        const lines = content.split(/\r?\n/);
        const fileMatches = searchFileContent(relPath, lines, regex);
        allMatches.push(...fileMatches);
      } catch {
        // Skip files that can't be read (permissions, etc.)
        continue;
      }
    }

    // Paginate results
    const result = paginate(allMatches, offset, maxResults);

    return {
      success: true,
      output: JSON.stringify(result),
    };
  },
};

export default plugin;
