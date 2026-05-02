/**
 * Memory-Write Tool Plugin — writes notes to the Obsidian vault.
 *
 * Delegates to the memory service which handles create-only, append, and
 * overwrite modes with appropriate safety rules. Requires user confirmation
 * only for "overwrite" mode; "append" and "create-only" proceed without
 * confirmation.
 */

import { z } from 'zod';
import type { ToolPlugin, ToolContext, ToolResult } from '@clover/shared';
import { writeNote } from '../../memory/memory.service.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  filePath: z.string().min(1, 'filePath is required'),
  content: z.string().min(1, 'content is required'),
  mode: z.enum(['create-only', 'append', 'overwrite']),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: 'memory-write',
  description:
    'Write a note to the Obsidian vault. Supports "create-only" (fails if file exists), "append" (adds content with separator), and "overwrite" (requires confirmation, creates .bak backup).',
  inputSchema,

  requiresConfirmation(args: unknown): boolean {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      return false;
    }
    return parsed.data.mode === 'overwrite';
  },

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const { filePath, content, mode } = inputSchema.parse(args);

    try {
      await writeNote(filePath, content, mode);
      return {
        success: true,
        output: `Note written successfully (mode: ${mode}): ${filePath}`,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown memory write error';
      return { success: false, output: '', error: message };
    }
  },
};

export default plugin;
