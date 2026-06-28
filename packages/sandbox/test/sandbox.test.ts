/**
 * ProcessSandbox (Tier 3) — propriedades de isolamento que corrigem P3:
 * sem injeção de shell, fronteira de workspace, timeout e gate de capability.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CapabilityToken } from '@clover/contracts';
import { ProcessSandbox, SandboxViolation } from '@clover/sandbox';

const NODE = process.execPath;

const dirs: string[] = [];
function workspace(): string {
  const d = mkdtempSync(join(tmpdir(), 'clover-sbx-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

/** Token que concede proc.exec para o binário do Node. */
function nodeToken(): CapabilityToken {
  return {
    id: 't',
    taskId: 'task',
    caps: [{ kind: 'proc.exec', argv0Allow: [NODE], maxProcs: 1 }],
    issuedAt: 0,
    expiresAt: Date.now() + 60_000,
    sig: 'test',
  };
}

describe('ProcessSandbox (Tier 3)', () => {
  it('runs an allowed command and captures stdout', async () => {
    const ws = workspace();
    const sbx = new ProcessSandbox();
    const r = await sbx.run({
      argv: [NODE, '-e', 'process.stdout.write("hi")'],
      cwd: ws,
      workspacePath: ws,
      token: nodeToken(),
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('hi');
    expect(r.timedOut).toBe(false);
  });

  it('passes args verbatim — no shell, no injection', async () => {
    const ws = workspace();
    const sbx = new ProcessSandbox();
    const r = await sbx.run({
      argv: [
        NODE,
        '-e',
        'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
        'a; echo PWNED',
        '$(whoami)',
        '`id`',
      ],
      cwd: ws,
      workspacePath: ws,
      token: nodeToken(),
    });
    // Metacaracteres chegam LITERAIS ao programa; nada foi interpretado.
    expect(JSON.parse(r.stdout)).toEqual(['a; echo PWNED', '$(whoami)', '`id`']);
    expect(r.stdout).not.toContain('PWNED\n');
  });

  it('kills processes that exceed the timeout', async () => {
    const ws = workspace();
    const sbx = new ProcessSandbox();
    const r = await sbx.run({
      argv: [NODE, '-e', 'setInterval(() => {}, 1000)'],
      cwd: ws,
      workspacePath: ws,
      token: nodeToken(),
      timeoutMs: 100,
    });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull(); // morto por SIGKILL
  });

  it('denies a program not granted by proc.exec', async () => {
    const ws = workspace();
    const sbx = new ProcessSandbox();
    const noCaps: CapabilityToken = { ...nodeToken(), caps: [] };
    await expect(
      sbx.run({ argv: [NODE, '-e', '1'], cwd: ws, workspacePath: ws, token: noCaps }),
    ).rejects.toBeInstanceOf(SandboxViolation);
  });

  it('blocks a cwd outside the workspace boundary', async () => {
    const ws = workspace();
    const sbx = new ProcessSandbox();
    await expect(
      sbx.run({
        argv: [NODE, '-e', '1'],
        cwd: resolve(ws, '..'), // escapa do workspace
        workspacePath: ws,
        token: nodeToken(),
      }),
    ).rejects.toBeInstanceOf(SandboxViolation);
  });
});
