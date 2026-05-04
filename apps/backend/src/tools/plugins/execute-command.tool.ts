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
// Command classification helpers
// ---------------------------------------------------------------------------

/**
 * Read-only PowerShell commands — safe to run without confirmation.
 * These only observe system state and never mutate files or processes.
 */
const READ_ONLY_PATTERN =
  /^\s*(Get-|Test-|Measure-|Select-|Where-|Format-|Out-|Write-Output|Write-Host|Write-Verbose|echo\b|dir\b|ls\b|type\b|cat\b|pwd\b|\$env:|resolve-path|split-path|join-path)/i;

/**
 * Explicitly destructive commands — always require confirmation regardless
 * of other heuristics.
 */
const DESTRUCTIVE_PATTERN =
  /\b(Remove-Item|rm\b|del\b|rd\b|rmdir\b|Format-|Clear-Disk|Stop-Process|Kill\b|taskkill\b|Disable-|Uninstall-|Drop\b|Truncate\b|DELETE\b|format\b)\b/i;

/**
 * Write / mutating commands that are not destructive but still change state.
 * Require confirmation once per unique (toolName, argsHash) pair.
 */
const WRITE_PATTERN =
  /\b(New-Item|mkdir\b|md\b|Copy-Item|Move-Item|Rename-Item|Set-Content|Add-Content|Out-File|Tee-Object|Set-ItemProperty|Set-Acl|icacls\b|attrib\b|reg\s+(add|delete|import)|npm\s+(install|uninstall|publish)|pnpm\s+(install|remove|publish|add)|yarn\s+(add|remove|publish))\b/i;

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: 'execute-command',
  description: 'Execute a shell command within the workspace.',
  inputSchema,

  requiresConfirmation(args: unknown): boolean {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) return true; // can't classify → be safe

    const { command } = parsed.data;

    // Read-only: never ask
    if (READ_ONLY_PATTERN.test(command)) return false;

    // Destructive: always ask
    if (DESTRUCTIVE_PATTERN.test(command)) return true;

    // Write/mutating: ask once (cache handled in agent-engine)
    if (WRITE_PATTERN.test(command)) return true;

    // Unknown: default to asking
    return true;
  },

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
