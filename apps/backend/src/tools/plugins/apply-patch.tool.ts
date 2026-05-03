/**
 * Apply-Patch Tool Plugin — surgical file editing via search-and-replace.
 *
 * Supports:
 *   - Exact search-and-replace with unique match enforcement
 *   - Multi-line search/replace blocks
 *   - Line range scoping (restrict search to specific lines)
 *   - Line range replacement (replace entire range when no searchString)
 *   - Flexible indentation matching (normalize leading whitespace)
 *   - Line ending detection and preservation (LF/CRLF)
 *   - Automatic backup via SnapshotManager before patching
 *
 * Throws PatchNotFoundError on 0 matches, AmbiguousMatchError on 2+ matches,
 * LineRangeError when range exceeds file length, WorkspaceBoundaryError when
 * path escapes workspace.
 *
 * requiresConfirmation always returns false (patches are non-destructive).
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolPlugin, ToolContext, ToolResult } from '@clover/shared';

import { PatchNotFoundError, LineRangeError } from '../../errors/patch-errors.js';
import { AmbiguousMatchError, WorkspaceBoundaryError } from './edit-file.tool.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  filePath: z.string().min(1),
  searchString: z.string().optional(),
  replaceString: z.string(),
  lineRange: z
    .object({
      start: z.number().int().min(1),
      end: z.number().int().min(1),
    })
    .optional(),
  flexibleIndent: z.boolean().default(true),
});

export type PatchInput = z.infer<typeof inputSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the target path and verify it stays within the workspace.
 * Throws WorkspaceBoundaryError if the resolved path escapes the boundary.
 */
function resolveAndValidate(filePath: string, workspacePath: string): string {
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
 * Detect the dominant line ending in a file's content.
 * Returns '\r\n' if CRLF is found, otherwise '\n'.
 */
function detectLineEnding(content: string): '\r\n' | '\n' {
  const crlfIndex = content.indexOf('\r\n');
  if (crlfIndex !== -1) {
    return '\r\n';
  }
  return '\n';
}

/**
 * Normalize content to use LF line endings for internal processing.
 */
function toLF(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Convert content from LF to the target line ending.
 */
function toLineEnding(content: string, ending: '\r\n' | '\n'): string {
  if (ending === '\r\n') {
    // First normalize to LF, then convert to CRLF
    return toLF(content).replace(/\n/g, '\r\n');
  }
  return toLF(content);
}

/**
 * Count non-overlapping occurrences of `search` in `text`.
 */
function countOccurrences(text: string, search: string): number {
  if (search.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

/**
 * Strip leading whitespace from each line of a string.
 * Returns the stripped string.
 */
function stripLeadingWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimStart())
    .join('\n');
}

/**
 * Find the indentation (leading whitespace) of a line.
 */
function getIndentation(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : '';
}

/**
 * Perform flexible-indent matching: find the search string in content
 * by stripping leading whitespace from both, then return the match
 * position in the original content.
 *
 * Returns an array of start indices in the original content where
 * the stripped search matches.
 */
function findFlexibleMatches(
  content: string,
  search: string,
): number[] {
  const contentLines = content.split('\n');
  const searchLines = search.split('\n').map((l) => l.trimStart());
  const searchLineCount = searchLines.length;

  if (searchLineCount === 0) return [];

  const matches: number[] = [];

  for (let i = 0; i <= contentLines.length - searchLineCount; i++) {
    let isMatch = true;
    for (let j = 0; j < searchLineCount; j++) {
      if (contentLines[i + j].trimStart() !== searchLines[j]) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) {
      // Calculate the character offset of line i in the original content
      let offset = 0;
      for (let k = 0; k < i; k++) {
        offset += contentLines[k].length + 1; // +1 for '\n'
      }
      matches.push(offset);
    }
  }

  return matches;
}

/**
 * Apply a replacement with flexible indentation.
 *
 * Given the original content, the match start position (line-based),
 * the number of search lines, and the replacement string, produce
 * the patched content preserving the original indentation.
 */
function applyFlexibleReplacement(
  content: string,
  matchLineIndex: number,
  searchLineCount: number,
  replaceString: string,
): string {
  const contentLines = content.split('\n');
  const originalIndent = getIndentation(contentLines[matchLineIndex]);

  const replaceLines = replaceString.split('\n');
  const indentedReplaceLines = replaceLines.map((line, idx) => {
    const stripped = line.trimStart();
    if (stripped.length === 0 && line.length === 0) return '';
    // For the first line, use the original indentation
    // For subsequent lines, preserve relative indentation from the replacement
    if (idx === 0) {
      return originalIndent + stripped;
    }
    // For subsequent lines, calculate relative indent from the replacement
    const firstReplaceIndent = getIndentation(replaceLines[0]);
    const currentIndent = getIndentation(line);
    // Relative indent = current indent beyond the first line's indent
    const relativeIndent = currentIndent.length > firstReplaceIndent.length
      ? currentIndent.slice(firstReplaceIndent.length)
      : '';
    return originalIndent + relativeIndent + stripped;
  });

  const before = contentLines.slice(0, matchLineIndex);
  const after = contentLines.slice(matchLineIndex + searchLineCount);

  return [...before, ...indentedReplaceLines, ...after].join('\n');
}

/**
 * Create a snapshot backup of the file before patching.
 */
async function createSnapshot(
  resolvedPath: string,
  workspacePath: string,
  sessionId: string,
): Promise<void> {
  if (!existsSync(resolvedPath)) return;

  const snapshotDir = path.join(
    workspacePath,
    '.clover',
    'snapshots',
    sessionId,
  );
  await fs.mkdir(snapshotDir, { recursive: true });
  const snapshotFile = path.join(
    snapshotDir,
    `${path.basename(resolvedPath)}.${Date.now()}.bak`,
  );
  await fs.copyFile(resolvedPath, snapshotFile);
}

// ---------------------------------------------------------------------------
// Core patch logic
// ---------------------------------------------------------------------------

interface PatchResult {
  patched: string;
  linesAffected: number;
}

export function applyPatch(
  fileContent: string,
  input: PatchInput,
  filePath: string,
): PatchResult {
  const lineEnding = detectLineEnding(fileContent);
  // Normalize to LF for internal processing
  let content = toLF(fileContent);

  const contentLines = content.split('\n');
  const totalLines = contentLines.length;

  // Validate lineRange if provided
  if (input.lineRange) {
    const { start, end } = input.lineRange;
    if (start > end) {
      throw new LineRangeError(filePath, start, totalLines);
    }
    if (end > totalLines) {
      throw new LineRangeError(filePath, end, totalLines);
    }
  }

  // Case: lineRange without searchString → replace entire range
  if (input.lineRange && !input.searchString) {
    const { start, end } = input.lineRange;
    const before = contentLines.slice(0, start - 1);
    const after = contentLines.slice(end);
    const replaceLines =
      input.replaceString.length > 0
        ? toLF(input.replaceString).split('\n')
        : [];
    const linesAffected = end - start + 1 + replaceLines.length;
    const result = [...before, ...replaceLines, ...after].join('\n');
    return { patched: toLineEnding(result, lineEnding), linesAffected };
  }

  // searchString is required for search-and-replace mode
  if (!input.searchString) {
    throw new PatchNotFoundError(filePath, '');
  }

  const searchString = toLF(input.searchString);

  // Determine the scope of content to search
  let scopeContent: string;
  let scopeOffset = 0; // character offset of scope start in full content
  let scopeLineOffset = 0; // line offset of scope start

  if (input.lineRange) {
    const { start, end } = input.lineRange;
    const scopeLines = contentLines.slice(start - 1, end);
    scopeContent = scopeLines.join('\n');
    scopeLineOffset = start - 1;
    // Calculate character offset
    for (let i = 0; i < start - 1; i++) {
      scopeOffset += contentLines[i].length + 1;
    }
  } else {
    scopeContent = content;
  }

  let patched: string;
  let linesAffected: number;

  if (input.flexibleIndent) {
    // Flexible indent matching
    const matches = findFlexibleMatches(scopeContent, searchString);

    if (matches.length === 0) {
      throw new PatchNotFoundError(filePath, input.searchString);
    }
    if (matches.length > 1) {
      throw new AmbiguousMatchError(input.searchString, matches.length);
    }

    // Find the line index of the match in the full content
    const scopeLines = scopeContent.split('\n');
    const searchLines = searchString.split('\n');
    let matchLineInScope = 0;
    let charCount = 0;
    for (let i = 0; i < scopeLines.length; i++) {
      if (charCount === matches[0]) {
        matchLineInScope = i;
        break;
      }
      charCount += scopeLines[i].length + 1;
    }

    const matchLineInContent = scopeLineOffset + matchLineInScope;
    const searchLineCount = searchLines.length;

    patched = applyFlexibleReplacement(
      content,
      matchLineInContent,
      searchLineCount,
      toLF(input.replaceString),
    );

    const replaceLineCount = input.replaceString.split('\n').length;
    linesAffected = Math.max(searchLineCount, replaceLineCount);
  } else {
    // Exact matching
    const occurrences = countOccurrences(scopeContent, searchString);

    if (occurrences === 0) {
      throw new PatchNotFoundError(filePath, input.searchString);
    }
    if (occurrences > 1) {
      throw new AmbiguousMatchError(input.searchString, occurrences);
    }

    // Replace in the scope, then reconstruct full content
    if (input.lineRange) {
      const patchedScope = scopeContent.replace(
        searchString,
        toLF(input.replaceString),
      );
      const before = content.slice(0, scopeOffset);
      const afterScopeOffset =
        scopeOffset + scopeContent.length;
      const after = content.slice(afterScopeOffset);
      patched = before + patchedScope + after;
    } else {
      patched = content.replace(searchString, toLF(input.replaceString));
    }

    const searchLineCount = searchString.split('\n').length;
    const replaceLineCount = toLF(input.replaceString).split('\n').length;
    linesAffected = Math.max(searchLineCount, replaceLineCount);
  }

  // Restore original line endings
  patched = toLineEnding(patched, lineEnding);

  return { patched, linesAffected };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: 'apply-patch',
  description:
    'Surgically edit a file using search-and-replace. Supports multi-line blocks, ' +
    'line range scoping, flexible indentation matching, and automatic backup. ' +
    'Requires exactly one match for the search string.',
  inputSchema,

  requiresConfirmation: () => false,

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(args);

    const workspacePath =
      process.env['CLOVER_WORKSPACE'] ?? ctx.workspacePath;

    const resolvedPath = resolveAndValidate(parsed.filePath, workspacePath);

    try {
      const fileContent = await fs.readFile(resolvedPath, 'utf-8');

      const { patched, linesAffected } = applyPatch(
        fileContent,
        parsed,
        parsed.filePath,
      );

      // Create snapshot before writing
      await createSnapshot(resolvedPath, workspacePath, ctx.sessionId);

      await fs.writeFile(resolvedPath, patched, 'utf-8');

      return {
        success: true,
        output: `Patch applied: ${parsed.filePath} (${linesAffected} lines affected)`,
      };
    } catch (err: unknown) {
      if (
        err instanceof PatchNotFoundError ||
        err instanceof AmbiguousMatchError ||
        err instanceof LineRangeError ||
        err instanceof WorkspaceBoundaryError
      ) {
        return {
          success: false,
          output: '',
          error: err.message,
        };
      }
      const message =
        err instanceof Error ? err.message : 'Unknown patch error';
      return { success: false, output: '', error: message };
    }
  },
};

export default plugin;
