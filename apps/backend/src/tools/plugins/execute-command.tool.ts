/**
 * Execute-Command Tool Plugin — runs shell commands within the workspace.
 *
 * Delegates to the exec-guard for deny-list enforcement, workspace-scoped cwd,
 * and configurable timeout. Always requires user confirmation since command
 * execution is a destructive operation.
 *
 * Streams stdout/stderr chunks to the UI via `terminal:output` WebSocket events.
 */

import path from 'node:path';
import { z } from 'zod';
import type { ToolPlugin, ToolContext, ToolResult } from '@clover/shared';
import { run } from '../../exec-guard/exec-guard.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  command: z.string().min(1, 'command is required'),
  cwd: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: 'execute-command',
  description: 'Execute a shell command within the workspace.',
  inputSchema,

  requiresConfirmation: () => true,

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { command, cwd } = inputSchema.parse(args);

    const workspacePath =
      process.env['CLOVER_WORKSPACE'] ?? ctx.workspacePath;

    const resolvedCwd = cwd
      ? path.resolve(workspacePath, cwd)
      : workspacePath;

    try {
      const result = await run(command, {
        cwd: resolvedCwd,
        onOutput(stream, chunk) {
          ctx.emitEvent('terminal:output', { stream, chunk });
        },
      });

      const output = [result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n');

      return {
        success: result.exitCode === 0,
        output: output || `Command exited with code ${result.exitCode}`,
        ...(result.exitCode !== 0
          ? { error: `Exit code ${result.exitCode}` }
          : {}),
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown execution error';
      return { success: false, output: '', error: message };
    }
  },
};

export default plugin;
