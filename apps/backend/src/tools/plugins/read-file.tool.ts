/**
 * Read-File Tool Plugin — reads file content within the workspace.
 *
 * Validates that the target path stays within the workspace boundary.
 * Never requires user confirmation (read-only operation).
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
  name: 'read-file',
  description: 'Read the content of a file within the workspace.',
  inputSchema,

  requiresConfirmation: () => false,

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { path: filePath } = inputSchema.parse(args);

    const workspacePath =
      process.env['CLOVER_WORKSPACE'] ?? ctx.workspacePath;

    const resolvedPath = resolveAndValidate(filePath, workspacePath);

    try {
      const content = await fs.readFile(resolvedPath, 'utf-8');
      return { success: true, output: content };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown read error';
      return { success: false, output: '', error: message };
    }
  },
};

export default plugin;
