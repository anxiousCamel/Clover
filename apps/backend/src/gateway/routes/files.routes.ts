/**
 * File Operation Routes — Fastify plugin that registers endpoints for
 * reading, creating, patching, and deleting files within the workspace,
 * plus a filesystem tree listing endpoint.
 *
 * Endpoints:
 * - `GET    /files?path=`                → read file content, mtime, size
 * - `POST   /files`                      → create a new file (409 if exists)
 * - `PATCH  /files`                      → apply patch operations
 * - `DELETE /files`                      → delete file (requires confirmation)
 * - `GET    /filesystem/tree?root=&depth=` → recursive directory tree
 *
 * All file paths are validated to stay within the workspace boundary.
 * The workspace root is determined by `CLOVER_WORKSPACE` env var or
 * falls back to `process.cwd()`.
 *
 * @module gateway/routes/files.routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { requestConfirmation } from '../ws.server.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Query params for GET /files */
interface ReadFileQuery {
  path: string;
}

/** Body for POST /files */
interface CreateFileBody {
  path: string;
  content: string;
}

/** A single patch operation (string replacement or line-range). */
interface PatchOperation {
  mode: 'string-replacement' | 'line-range';
  oldStr?: string;
  newStr?: string;
  startLine?: number;
  endLine?: number;
  content?: string;
}

/** Body for PATCH /files */
interface PatchFileBody {
  path: string;
  operations: PatchOperation[];
}

/** Body for DELETE /files */
interface DeleteFileBody {
  path: string;
}

/** Query params for GET /filesystem/tree */
interface TreeQuery {
  root?: string;
  depth?: number;
}

/** A node in the filesystem tree. */
interface FileNode {
  name: string;
  type: 'file' | 'directory';
  size: number;
  mtime: string;
  children?: FileNode[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the resolved workspace root path.
 */
function getWorkspacePath(): string {
  return path.resolve(process.env['CLOVER_WORKSPACE'] ?? process.cwd());
}

/**
 * Resolve a relative file path against the workspace and validate that
 * it stays within the workspace boundary.
 *
 * @throws Error if the resolved path escapes the workspace.
 */
function resolveAndValidate(filePath: string, workspacePath: string): string {
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
 * Recursively build a FileNode tree for the given directory up to maxDepth.
 */
async function buildTree(
  dirPath: string,
  currentDepth: number,
  maxDepth: number,
): Promise<FileNode[]> {
  const nodes: FileNode[] = [];

  let dirents;
  try {
    dirents = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return nodes;
  }

  for (const dirent of dirents) {
    const fullPath = path.join(dirPath, dirent.name);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }

    const isDir = dirent.isDirectory();
    const node: FileNode = {
      name: dirent.name,
      type: isDir ? 'directory' : 'file',
      size: stat.size,
      mtime: stat.mtime.toISOString(),
    };

    if (isDir && currentDepth < maxDepth) {
      node.children = await buildTree(fullPath, currentDepth + 1, maxDepth);
    }

    nodes.push(node);
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// JSON Schemas (Fastify validation)
// ---------------------------------------------------------------------------

const readFileQuerySchema = {
  querystring: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: { type: 'string' as const, minLength: 1 },
    },
  },
};

const createFileSchema = {
  body: {
    type: 'object' as const,
    required: ['path', 'content'],
    properties: {
      path: { type: 'string' as const, minLength: 1 },
      content: { type: 'string' as const },
    },
    additionalProperties: false,
  },
};

const patchFileSchema = {
  body: {
    type: 'object' as const,
    required: ['path', 'operations'],
    properties: {
      path: { type: 'string' as const, minLength: 1 },
      operations: {
        type: 'array' as const,
        minItems: 1,
        items: {
          type: 'object' as const,
          required: ['mode'],
          properties: {
            mode: {
              type: 'string' as const,
              enum: ['string-replacement', 'line-range'],
            },
            oldStr: { type: 'string' as const },
            newStr: { type: 'string' as const },
            startLine: { type: 'number' as const },
            endLine: { type: 'number' as const },
            content: { type: 'string' as const },
          },
        },
      },
    },
    additionalProperties: false,
  },
};

const deleteFileSchema = {
  body: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: { type: 'string' as const, minLength: 1 },
    },
    additionalProperties: false,
  },
};

const treeQuerySchema = {
  querystring: {
    type: 'object' as const,
    properties: {
      root: { type: 'string' as const, default: '.' },
      depth: { type: 'number' as const, default: 1, minimum: 1 },
    },
  },
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin that registers file operation and filesystem tree routes.
 *
 * Registered with a `/api` prefix by the Gateway so that the full paths
 * become `/api/files`, `/api/filesystem/tree`, etc.
 */
export default async function filesRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /files ──────────────────────────────────────────

  /**
   * Read a file's content, modification time, and size.
   *
   * Query: `?path=relative/path/to/file`
   * Returns: `{ content, mtime, size }`
   */
  fastify.get<{ Querystring: ReadFileQuery }>(
    '/files',
    { schema: readFileQuerySchema },
    async (request: FastifyRequest<{ Querystring: ReadFileQuery }>, reply: FastifyReply) => {
      const filePath = request.query.path;
      const workspacePath = getWorkspacePath();

      let resolvedPath: string;
      try {
        resolvedPath = resolveAndValidate(filePath, workspacePath);
      } catch {
        return reply.status(403).send({
          error: `Path is outside the workspace`,
          code: 'WORKSPACE_BOUNDARY_ERROR',
        });
      }

      try {
        const [content, stat] = await Promise.all([
          fs.readFile(resolvedPath, 'utf-8'),
          fs.stat(resolvedPath),
        ]);

        return reply.send({
          content,
          mtime: stat.mtime.toISOString(),
          size: stat.size,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown read error';
        return reply.status(404).send({
          error: message,
          code: 'FILE_NOT_FOUND',
        });
      }
    },
  );

  // ── POST /files ─────────────────────────────────────────

  /**
   * Create a new file within the workspace.
   *
   * Returns 201 on success, 409 if the file already exists.
   * Creates parent directories if they don't exist.
   */
  fastify.post<{ Body: CreateFileBody }>(
    '/files',
    { schema: createFileSchema },
    async (request: FastifyRequest<{ Body: CreateFileBody }>, reply: FastifyReply) => {
      const { path: filePath, content } = request.body;
      const workspacePath = getWorkspacePath();

      let resolvedPath: string;
      try {
        resolvedPath = resolveAndValidate(filePath, workspacePath);
      } catch {
        return reply.status(403).send({
          error: `Path is outside the workspace`,
          code: 'WORKSPACE_BOUNDARY_ERROR',
        });
      }

      // Check if file already exists
      if (existsSync(resolvedPath)) {
        return reply.status(409).send({
          error: `File already exists: ${filePath}`,
          code: 'FILE_EXISTS',
        });
      }

      try {
        // Create parent directories if needed
        const parentDir = path.dirname(resolvedPath);
        await fs.mkdir(parentDir, { recursive: true });

        await fs.writeFile(resolvedPath, content, 'utf-8');
        return reply.status(201).send({
          created: filePath,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown write error';
        return reply.status(500).send({
          error: message,
          code: 'WRITE_ERROR',
        });
      }
    },
  );

  // ── PATCH /files ────────────────────────────────────────

  /**
   * Apply patch operations to a file.
   *
   * Supports two modes per operation:
   * - `string-replacement`: replace `oldStr` with `newStr` (exact match)
   * - `line-range`: replace lines `startLine`–`endLine` with `content`
   *
   * Returns `{ linesChanged }` on success.
   */
  fastify.patch<{ Body: PatchFileBody }>(
    '/files',
    { schema: patchFileSchema },
    async (request: FastifyRequest<{ Body: PatchFileBody }>, reply: FastifyReply) => {
      const { path: filePath, operations } = request.body;
      const workspacePath = getWorkspacePath();

      let resolvedPath: string;
      try {
        resolvedPath = resolveAndValidate(filePath, workspacePath);
      } catch {
        return reply.status(403).send({
          error: `Path is outside the workspace`,
          code: 'WORKSPACE_BOUNDARY_ERROR',
        });
      }

      try {
        let fileContent = await fs.readFile(resolvedPath, 'utf-8');
        let totalLinesChanged = 0;

        for (const op of operations) {
          if (op.mode === 'string-replacement') {
            const oldStr = op.oldStr ?? '';
            const newStr = op.newStr ?? '';

            if (!oldStr) {
              return reply.status(400).send({
                error: 'oldStr is required for string-replacement mode',
                code: 'VALIDATION_ERROR',
              });
            }

            const occurrences = countOccurrences(fileContent, oldStr);

            if (occurrences === 0) {
              return reply.status(400).send({
                error: 'Pattern not found in file',
                code: 'PATTERN_NOT_FOUND',
              });
            }

            if (occurrences > 1) {
              return reply.status(400).send({
                error: `Pattern matched ${occurrences} locations (expected exactly 1)`,
                code: 'AMBIGUOUS_MATCH',
              });
            }

            fileContent = fileContent.replace(oldStr, newStr);
            const oldLineCount = oldStr.split('\n').length;
            const newLineCount = newStr.split('\n').length;
            totalLinesChanged += Math.abs(newLineCount - oldLineCount) || oldLineCount;
          } else if (op.mode === 'line-range') {
            const startLine = op.startLine ?? 1;
            const endLine = op.endLine ?? 1;
            const content = op.content ?? '';

            if (startLine > endLine) {
              return reply.status(400).send({
                error: `startLine (${startLine}) must be <= endLine (${endLine})`,
                code: 'VALIDATION_ERROR',
              });
            }

            const lines = fileContent.split('\n');

            if (startLine > lines.length) {
              return reply.status(400).send({
                error: `startLine (${startLine}) exceeds file length (${lines.length} lines)`,
                code: 'VALIDATION_ERROR',
              });
            }

            const clampedEnd = Math.min(endLine, lines.length);
            const newLines = content.length > 0 ? content.split('\n') : [];
            const before = lines.slice(0, startLine - 1);
            const after = lines.slice(clampedEnd);

            fileContent = [...before, ...newLines, ...after].join('\n');
            totalLinesChanged += (clampedEnd - startLine + 1) + newLines.length;
          }
        }

        await fs.writeFile(resolvedPath, fileContent, 'utf-8');

        return reply.send({ linesChanged: totalLinesChanged });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown patch error';
        return reply.status(500).send({
          error: message,
          code: 'PATCH_ERROR',
        });
      }
    },
  );

  // ── DELETE /files ───────────────────────────────────────

  /**
   * Delete a file within the workspace.
   *
   * Requires user confirmation via the Confirmation Bus / WebSocket.
   * Returns 200 on success, 403 if the user denies the deletion.
   */
  fastify.delete<{ Body: DeleteFileBody }>(
    '/files',
    { schema: deleteFileSchema },
    async (request: FastifyRequest<{ Body: DeleteFileBody }>, reply: FastifyReply) => {
      const { path: filePath } = request.body;
      const workspacePath = getWorkspacePath();

      let resolvedPath: string;
      try {
        resolvedPath = resolveAndValidate(filePath, workspacePath);
      } catch {
        return reply.status(403).send({
          error: `Path is outside the workspace`,
          code: 'WORKSPACE_BOUNDARY_ERROR',
        });
      }

      // Verify file exists before requesting confirmation
      if (!existsSync(resolvedPath)) {
        return reply.status(404).send({
          error: `File not found: ${filePath}`,
          code: 'FILE_NOT_FOUND',
        });
      }

      // Request user confirmation via the Confirmation Bus.
      // We need a sessionId to route the WS event. Extract from query or
      // header; fall back to a broadcast approach if not provided.
      const sessionId =
        (request.headers['x-session-id'] as string | undefined) ?? 'default';

      try {
        const approved = await requestConfirmation(sessionId, {
          requestId: randomUUID(),
          toolName: 'delete-file',
          operation: 'delete',
          details: `Delete file: ${filePath}`,
          args: { path: filePath },
        });

        if (!approved) {
          return reply.status(403).send({
            error: 'User denied the deletion',
            code: 'USER_DENIED',
          });
        }

        await fs.unlink(resolvedPath);
        return reply.send({ deleted: filePath });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown delete error';
        return reply.status(500).send({
          error: message,
          code: 'DELETE_ERROR',
        });
      }
    },
  );

  // ── GET /filesystem/tree ────────────────────────────────

  /**
   * Return a recursive directory tree starting from the given root
   * within the workspace, up to the specified depth.
   *
   * Query: `?root=.&depth=1`
   * Returns: `FileNode[]`
   */
  fastify.get<{ Querystring: TreeQuery }>(
    '/filesystem/tree',
    { schema: treeQuerySchema },
    async (request: FastifyRequest<{ Querystring: TreeQuery }>, reply: FastifyReply) => {
      const root = request.query.root ?? '.';
      const depth = request.query.depth ?? 1;
      const workspacePath = getWorkspacePath();

      let resolvedRoot: string;
      try {
        resolvedRoot = resolveAndValidate(root, workspacePath);
      } catch {
        return reply.status(403).send({
          error: `Path is outside the workspace`,
          code: 'WORKSPACE_BOUNDARY_ERROR',
        });
      }

      try {
        const tree = await buildTree(resolvedRoot, 1, depth);
        return reply.send(tree);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown tree error';
        return reply.status(500).send({
          error: message,
          code: 'TREE_ERROR',
        });
      }
    },
  );
}
