/**
 * Exec Guard — safe subprocess execution with deny-list enforcement,
 * workspace-scoped cwd, configurable timeout, and streaming output.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from '../config/config.js';
import { isDenied } from './deny-list.js';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class DeniedCommandError extends Error {
  constructor(command: string) {
    super(`Command denied by exec guard: ${command}`);
    this.name = 'DeniedCommandError';
  }
}

export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Command timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunOptions {
  cwd: string;
  timeout?: number;
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Run a shell command inside the workspace with safety checks.
 *
 * 1. Checks deny-list — throws DeniedCommandError on match.
 * 2. Validates cwd is within the workspace path.
 * 3. Spawns with configurable timeout — throws TimeoutError on expiry.
 * 4. Streams stdout/stderr via optional onOutput callback.
 */
export function run(cmd: string, opts: RunOptions): Promise<RunResult> {
  // --- deny-list check ---
  if (isDenied(cmd)) {
    throw new DeniedCommandError(cmd);
  }

  // --- cwd validation (must be within workspace) ---
  const workspacePath = process.env['CLOVER_WORKSPACE'] ?? process.cwd();
  const resolvedCwd = path.resolve(opts.cwd);
  const resolvedWorkspace = path.resolve(workspacePath);

  if (
    !resolvedCwd.startsWith(resolvedWorkspace + path.sep) &&
    resolvedCwd !== resolvedWorkspace
  ) {
    throw new Error(
      `cwd "${opts.cwd}" is outside the workspace "${workspacePath}"`,
    );
  }

  const timeoutMs = opts.timeout ?? config.execGuard.timeoutMs;

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(cmd, {
      shell: true,
      cwd: resolvedCwd,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    // --- timeout ---
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(new TimeoutError(timeoutMs));
      }
    }, timeoutMs);

    // --- stream stdout ---
    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      opts.onOutput?.('stdout', chunk);
    });

    // --- stream stderr ---
    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      opts.onOutput?.('stderr', chunk);
    });

    // --- process exit ---
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      }
    });

    // --- spawn error ---
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}
