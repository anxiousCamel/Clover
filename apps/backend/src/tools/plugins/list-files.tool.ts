/**
 * List-Files Tool Plugin — lists directory entries within the workspace.
 *
 * Returns name, type, size, and mtime for each entry.
 * Supports a depth parameter for recursive listing (default 1).
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
  depth: z.number().int().min(1).default(1),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  mtime: string;
}

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

/**
 * Recursively list directory entries up to the specified depth.
 */
async function listEntries(
  dirPath: string,
  currentDepth: number,
  maxDepth: number,
): Promise<DirectoryEntry[]> {
  const entries: DirectoryEntry[] = [];
  const dirents = await fs.readdir(dirPath, { withFileTypes: true });

  for (const dirent of dirents) {
    const fullPath = path.join(dirPath, dirent.name);
    const stat = await fs.stat(fullPath);
    const type = dirent.isDirectory() ? 'directory' : 'file';

    entries.push({
      name: dirent.name,
      type,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
    });

    if (type === 'directory' && currentDepth < maxDepth) {
      const children = await listEntries(fullPath, currentDepth + 1, maxDepth);
      for (const child of children) {
        entries.push({
          ...child,
          name: path.join(dirent.name, child.name),
        });
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: 'list-files',
  description:
    'List directory entries within the workspace with name, type, size, and modification time. Supports recursive listing via depth parameter.',
  inputSchema,

  requiresConfirmation: () => false,

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { path: dirPath, depth } = inputSchema.parse(args);

    const workspacePath =
      process.env['CLOVER_WORKSPACE'] ?? ctx.workspacePath;

    const resolvedPath = resolveAndValidate(dirPath, workspacePath);

    try {
      const entries = await listEntries(resolvedPath, 1, depth);
      return { success: true, output: JSON.stringify(entries) };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown list error';
      return { success: false, output: '', error: message };
    }
  },
};

export default plugin;
