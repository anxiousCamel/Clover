/**
 * Edit-File Tool Plugin — patches file content within the workspace.
 *
 * Supports two editing modes:
 *   1. String replacement: replace `oldStr` with `newStr` (exact match)
 *   2. Line-range replacement: replace lines `startLine`–`endLine` with `content`
 *
 * Never rewrites the full file — only the targeted region is modified.
 * Throws AmbiguousMatchError if a string-replacement pattern matches more
 * than one location in the file.
 *
 * requiresConfirmation always returns false (patches are non-destructive).
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolPlugin, ToolContext, ToolResult } from '@clover/shared';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class WorkspaceBoundaryError extends Error {
  constructor(filePath: string, workspacePath: string) {
    super(
      `Path "${filePath}" is outside the workspace "${workspacePath}"`,
    );
    this.name = 'WorkspaceBoundaryError';
  }
}

export class AmbiguousMatchError extends Error {
  public readonly matchCount: number;

  constructor(pattern: string, matchCount: number) {
    super(
      `Pattern matched ${matchCount} locations in the file (expected exactly 1). Pattern: "${pattern}"`,
    );
    this.name = 'AmbiguousMatchError';
    this.matchCount = matchCount;
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const stringReplacementSchema = z.object({
  mode: z.literal('string-replacement'),
  path: z.string().min(1, 'path is required'),
  oldStr: z.string().min(1, 'oldStr is required'),
  newStr: z.string(),
});

const lineRangeSchema = z.object({
  mode: z.literal('line-range'),
  path: z.string().min(1, 'path is required'),
  startLine: z.number().int().min(1, 'startLine must be >= 1'),
  endLine: z.number().int().min(1, 'endLine must be >= 1'),
  content: z.string(),
});

const inputSchema = z.discriminatedUnion('mode', [
  stringReplacementSchema,
  lineRangeSchema,
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the target path and verify it stays within the workspace.
 * Throws WorkspaceBoundaryError if the resolved path escapes the boundary.
 */
function resolveAndValidate(
  filePath: string,
  workspacePath: string,
): string {
  // If it's an absolute path, allow it
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedTarget = path.resolve(resolvedWorkspace, filePath);

  if (
    resolvedTarget !== resolvedWorkspace &&
    !resolvedTarget.startsWith(resolvedWorkspace + path.sep)
  ) {
    throw new WorkspaceBoundaryError(filePath, workspacePath);
  }

  return resolvedTarget;
}

/**
 * Count non-overlapping occurrences of `search` in `text`.
 */
function countOccurrences(text: string, search: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

/**
 * Apply a string-replacement patch.
 *
 * Throws AmbiguousMatchError if `oldStr` matches more than one location.
 * Returns the patched file content and the number of lines changed.
 */
function applyStringReplacement(
  fileContent: string,
  oldStr: string,
  newStr: string,
): { patched: string; linesChanged: number } {
  const occurrences = countOccurrences(fileContent, oldStr);

  if (occurrences === 0) {
    throw new Error('Pattern not found in file');
  }

  if (occurrences > 1) {
    throw new AmbiguousMatchError(oldStr, occurrences);
  }

  const patched = fileContent.replace(oldStr, newStr);
  const oldLineCount = oldStr.split('\n').length;
  const newLineCount = newStr.split('\n').length;
  const linesChanged = Math.abs(newLineCount - oldLineCount) || oldLineCount;

  return { patched, linesChanged };
}

/**
 * Apply a line-range replacement patch.
 *
 * Replaces lines from `startLine` to `endLine` (1-based, inclusive) with
 * the provided `content`. Returns the patched file content and the number
 * of lines changed.
 */
function applyLineRangeReplacement(
  fileContent: string,
  startLine: number,
  endLine: number,
  content: string,
): { patched: string; linesChanged: number } {
  const lines = fileContent.split('\n');

  if (startLine > endLine) {
    throw new Error(
      `startLine (${startLine}) must be <= endLine (${endLine})`,
    );
  }

  if (startLine > lines.length) {
    throw new Error(
      `startLine (${startLine}) exceeds file length (${lines.length} lines)`,
    );
  }

  // Clamp endLine to file length
  const clampedEnd = Math.min(endLine, lines.length);

  const newLines = content.length > 0 ? content.split('\n') : [];
  const before = lines.slice(0, startLine - 1);
  const after = lines.slice(clampedEnd);

  const patched = [...before, ...newLines, ...after].join('\n');
  const linesChanged = (clampedEnd - startLine + 1) + newLines.length;

  return { patched, linesChanged };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: 'edit-file',
  description:
    'Patch a file within the workspace using string replacement or line-range replacement. Never rewrites the full file.',
  inputSchema,

  requiresConfirmation: () => false,

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(args);

    const workspacePath =
      process.env['CLOVER_WORKSPACE'] ?? ctx.workspacePath;

    const resolvedPath = resolveAndValidate(parsed.path, workspacePath);

    try {
      const fileContent = await fs.readFile(resolvedPath, 'utf-8');

      let patched: string;
      let linesChanged: number;

      if (parsed.mode === 'string-replacement') {
        ({ patched, linesChanged } = applyStringReplacement(
          fileContent,
          parsed.oldStr,
          parsed.newStr,
        ));
      } else {
        ({ patched, linesChanged } = applyLineRangeReplacement(
          fileContent,
          parsed.startLine,
          parsed.endLine,
          parsed.content,
        ));
      }

      // Snapshot before patching
      if (existsSync(resolvedPath)) {
        const snapshotDir = path.join(workspacePath, '.clover', 'snapshots', ctx.sessionId);
        await fs.mkdir(snapshotDir, { recursive: true });
        const snapshotFile = path.join(snapshotDir, `${path.basename(resolvedPath)}.${Date.now()}.bak`);
        await fs.copyFile(resolvedPath, snapshotFile);
      }

      await fs.writeFile(resolvedPath, patched, 'utf-8');

      return {
        success: true,
        output: `File patched: ${parsed.path} (${linesChanged} lines affected)`,
      };
    } catch (err: unknown) {
      if (
        err instanceof AmbiguousMatchError ||
        err instanceof WorkspaceBoundaryError
      ) {
        throw err;
      }
      const message =
        err instanceof Error ? err.message : 'Unknown edit error';
      return { success: false, output: '', error: message };
    }
  },
};

export default plugin;
