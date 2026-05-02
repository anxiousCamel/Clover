/**
 * Reversa-Ingest Tool Plugin — ingests Reversa skill files and CLAUDE.md
 * into the memory system with source="reversa" tagging.
 *
 * Reads `.agents/skills/*.md` files and optionally `CLAUDE.md` from the
 * workspace, then indexes them into LanceDB for RAG retrieval.
 * Never requires user confirmation (read-only ingestion).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ToolPlugin, ToolContext, ToolResult } from '@clover/shared';
import * as memory from '../../memory/memory.service.js';

// ---------------------------------------------------------------------------
// Schema — no arguments required
// ---------------------------------------------------------------------------

const inputSchema = z.object({});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a file or directory exists at the given absolute path.
 */
async function exists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read all markdown files from a directory and index each with the given
 * source tag via memory.service.indexText.
 *
 * @returns number of files ingested
 */
async function ingestDirectoryWithSource(
  dirPath: string,
  source: string,
): Promise<number> {
  if (!(await exists(dirPath))) {
    return 0;
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const mdFiles = entries
    .filter((e: { isFile(): boolean; name: string }) => e.isFile() && e.name.endsWith('.md'))
    .map((e: { name: string }) => path.join(dirPath, e.name));

  for (const file of mdFiles) {
    const content = await fs.readFile(file, 'utf-8');
    await memory.indexText(content, { source });
  }

  return mdFiles.length;
}

/**
 * Read a single file and index it with the given source tag via
 * memory.service.indexText.
 */
async function indexFileWithSource(
  filePath: string,
  source: string,
): Promise<boolean> {
  if (!(await exists(filePath))) {
    return false;
  }

  const content = await fs.readFile(filePath, 'utf-8');
  await memory.indexText(content, { source });
  return true;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: 'reversa-ingest',
  description:
    'Ingest Reversa skill files (.agents/skills/) and CLAUDE.md into memory with source="reversa" tagging for RAG retrieval.',
  inputSchema,

  requiresConfirmation: () => false,

  async execute(_args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const workspacePath =
      process.env['CLOVER_WORKSPACE'] ?? ctx.workspacePath;

    const skillsDir = path.join(workspacePath, '.agents', 'skills');
    const claudeMdPath = path.join(workspacePath, 'CLAUDE.md');

    try {
      const skillCount = await ingestDirectoryWithSource(
        skillsDir,
        'reversa',
      );

      const claudeIngested = await indexFileWithSource(
        claudeMdPath,
        'reversa',
      );

      const parts: string[] = [];
      parts.push(`Ingested ${skillCount} skill file(s) from .agents/skills/`);
      if (claudeIngested) {
        parts.push('Indexed CLAUDE.md');
      } else {
        parts.push('CLAUDE.md not found, skipped');
      }

      return {
        success: true,
        output: parts.join('. ') + '.',
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown ingestion error';
      return { success: false, output: '', error: message };
    }
  },
};

export default plugin;
