/**
 * Delete-File Tool Plugin — deletes a file within the workspace.
 *
 * Validates that the target path stays within the workspace boundary.
 * Always requires user confirmation (deletion is a destructive operation).
 * The tool-registry handles the confirmation flow and returns `user_denied`
 * when the user denies the operation.
 */

import fs from 'node:fs/promises';
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
  name: 'delete-file',
  description: 'Delete a file within the workspace.',
  inputSchema,

  requiresConfirmation: () => true,

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { path: filePath } = inputSchema.parse(args);

    const workspacePath =
      process.env['CLOVER_WORKSPACE'] ?? ctx.workspacePath;

    const resolvedPath = resolveAndValidate(filePath, workspacePath);

    try {
      await fs.unlink(resolvedPath);
      return { success: true, output: `File deleted: ${filePath}` };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown delete error';
      return { success: false, output: '', error: message };
    }
  },
};

export default plugin;
