/**
 * Rollback-File Tool Plugin — restores a file from its most recent snapshot.
 *
 * Looks in `.clover/snapshots/{sessionId}/` for backup files matching
 * `{basename}.{timestamp}.bak`, sorts by timestamp descending, and copies
 * the most recent backup back to the original file path.
 *
 * Also exports a `cleanupSession()` helper that removes the entire session
 * snapshot directory — intended to be called by the session manager on
 * session end.
 *
 * requiresConfirmation always returns false (rollback restores a known-good
 * state).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ToolPlugin, ToolContext, ToolResult } from '@clover/shared';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  filePath: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the target path and verify it stays within the workspace.
 * Throws if the resolved path escapes the workspace boundary.
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
    throw new Error(
      `Path "${filePath}" is outside the workspace "${workspacePath}"`,
    );
  }

  return resolvedTarget;
}

/**
 * Find the most recent backup for a given file in the session's snapshot
 * directory.
 *
 * Backup filenames follow the pattern `{basename}.{timestamp}.bak` where
 * `{basename}` is the original filename (e.g. `output.txt`) and
 * `{timestamp}` is a millisecond epoch value.
 *
 * Returns the full path to the most recent backup, or `undefined` if none
 * exist.
 */
async function findLatestBackup(
  resolvedFilePath: string,
  workspacePath: string,
  sessionId: string,
): Promise<string | undefined> {
  const snapshotDir = path.join(
    workspacePath,
    '.clover',
    'snapshots',
    sessionId,
  );

  let entries: string[];
  try {
    entries = await fs.readdir(snapshotDir);
  } catch {
    // Directory doesn't exist — no backups available
    return undefined;
  }

  const basename = path.basename(resolvedFilePath);
  // Match files like `{basename}.{digits}.bak`
  const pattern = new RegExp(
    `^${escapeRegExp(basename)}\\.(\\d+)\\.bak$`,
  );

  const matches: { file: string; timestamp: number }[] = [];

  for (const entry of entries) {
    const m = pattern.exec(entry);
    if (m) {
      matches.push({ file: entry, timestamp: Number(m[1]) });
    }
  }

  if (matches.length === 0) return undefined;

  // Sort descending by timestamp — most recent first
  matches.sort((a, b) => b.timestamp - a.timestamp);

  return path.join(snapshotDir, matches[0].file);
}

/**
 * Escape special regex characters in a string so it can be used as a
 * literal pattern inside a RegExp constructor.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Restore the most recent backup for `filePath` within the given session.
 *
 * Returns the path to the backup that was restored, or `undefined` if no
 * backup was found.
 */
export async function rollback(
  filePath: string,
  workspacePath: string,
  sessionId: string,
): Promise<string | undefined> {
  const resolvedPath = resolveAndValidate(filePath, workspacePath);
  const backupPath = await findLatestBackup(
    resolvedPath,
    workspacePath,
    sessionId,
  );

  if (!backupPath) return undefined;

  // Ensure the target directory exists (the original file may have been
  // deleted as part of a failed operation).
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.copyFile(backupPath, resolvedPath);

  return backupPath;
}

/**
 * Remove the entire snapshot directory for a session.
 *
 * Intended to be called by the session manager when a session ends to
 * free disk space.
 */
export async function cleanupSession(
  sessionId: string,
  workspacePath: string,
): Promise<void> {
  const snapshotDir = path.join(
    workspacePath,
    '.clover',
    'snapshots',
    sessionId,
  );

  try {
    await fs.rm(snapshotDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup — ignore errors (directory may not exist)
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: 'rollback-file',
  description:
    'Restore a file from its most recent snapshot backup. Looks in ' +
    '`.clover/snapshots/{sessionId}/` for the latest backup matching the ' +
    'given file path and copies it back to the original location.',
  inputSchema,

  requiresConfirmation: () => false,

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { filePath } = inputSchema.parse(args);

    const workspacePath =
      process.env['CLOVER_WORKSPACE'] ?? ctx.workspacePath;

    try {
      const backupPath = await rollback(filePath, workspacePath, ctx.sessionId);

      if (!backupPath) {
        return {
          success: false,
          output: '',
          error: `No backup found for "${filePath}" in session ${ctx.sessionId}`,
        };
      }

      return {
        success: true,
        output: `File restored: ${filePath} (from ${path.basename(backupPath)})`,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown rollback error';
      return { success: false, output: '', error: message };
    }
  },
};

export default plugin;
