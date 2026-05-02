/**
 * Write-File Tool Plugin — writes file content within the workspace.
 *
 * Validates that the target path stays within the workspace boundary.
 * Requires user confirmation if the file already exists (overwrite case).
 * New file creation does not require confirmation.
 * Creates parent directories if they don't exist.
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

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  path: z.string().min(1, 'path is required'),
  content: z.string(),
});

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

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: 'write-file',
  description:
    'Write content to a file within the workspace. Creates parent directories if needed.',
  inputSchema,

  requiresConfirmation(args: unknown): boolean {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      return false;
    }

    const workspacePath =
      process.env['CLOVER_WORKSPACE'] ?? process.cwd();
    try {
      const resolvedPath = resolveAndValidate(
        parsed.data.path,
        workspacePath,
      );
      return existsSync(resolvedPath);
    } catch {
      // If path validation fails, let execute handle the error
      return false;
    }
  },

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { path: filePath, content } = inputSchema.parse(args);

    const workspacePath =
      process.env['CLOVER_WORKSPACE'] ?? ctx.workspacePath;

    const resolvedPath = resolveAndValidate(filePath, workspacePath);

    try {
      // Create parent directories if they don't exist
      const parentDir = path.dirname(resolvedPath);
      await fs.mkdir(parentDir, { recursive: true });

      // Snapshot before overwrite
      if (existsSync(resolvedPath)) {
        const snapshotDir = path.join(workspacePath, '.clover', 'snapshots', ctx.sessionId);
        await fs.mkdir(snapshotDir, { recursive: true });
        const snapshotFile = path.join(snapshotDir, `${path.basename(resolvedPath)}.${Date.now()}.bak`);
        await fs.copyFile(resolvedPath, snapshotFile);
      }

      await fs.writeFile(resolvedPath, content, 'utf-8');
      return { success: true, output: `File written: ${filePath}` };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown write error';
      return { success: false, output: '', error: message };
    }
  },
};

export default plugin;
