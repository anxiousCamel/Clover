/**
 * git/ escrita — Testes de integração REAIS: cria repositório git temporário,
 * executa as tools de escrita (git_commit, git_checkout_branch, git_restore,
 * git_revert) através do handler Zod + Sandbox Tier 3, e verifica a saída.
 *
 * Padrão de asserção: `handler(args, ctx)` retorna `ToolResult` —
 * `{ success: boolean, output: T | null, error?: string }`. Nunca lança.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CapabilityToken, ToolInvocation } from '@clover/contracts';

import {
  gitCheckoutBranchTool,
  gitCommitTool,
  gitRestoreTool,
  gitRevertTool,
} from '../src/git/index.js';

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_GIT = gitAvailable();

/** Token com proc.exec para git (espelha o que o Kernel cunha via deriveCaps). */
function tokenFor(): CapabilityToken {
  return {
    id: 'git-write-test',
    taskId: 'test-task',
    caps: [{ kind: 'proc.exec', argv0Allow: ['git'], maxProcs: 4 }],
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    sig: 'test',
  };
}

describe.skipIf(!HAS_GIT)('git/ write tools (handler direto + Sandbox Tier 3)', () => {
  let dir: string;

  function ctx(): ToolInvocation {
    return {
      taskId: 'test-task',
      traceId: 'test-trace',
      workspacePath: dir,
      token: tokenFor(),
      emit: () => {},
    };
  }

  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'clover-git-write-'));
    // Inicializa repositório limpo com identidade local e sem conversão CRLF.
    const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    g('-c', 'init.defaultBranch=main', 'init');
    g('config', 'user.email', 'test@clover.dev');
    g('config', 'user.name', 'Clover Test');
    g('config', 'core.autocrlf', 'false'); // sem conversão LF↔CRLF nos testes
    writeFileSync(join(dir, 'a.txt'), 'linha 1\n');
    g('add', 'a.txt');
    g('commit', '-m', 'commit inicial');
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // git_commit
  // ---------------------------------------------------------------------------

  it('git_commit cria commit com stageAll=true (inclui arquivo novo)', async () => {
    writeFileSync(join(dir, 'novo.txt'), 'novo arquivo\n');
    const res = await gitCommitTool.handler(
      { message: 'feat: adicionar novo.txt', stageAll: true },
      ctx(),
    );
    expect(res.success).toBe(true);
    const out = res.output as { hash: string; branch: string; message: string };
    expect(out.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(out.branch).toBe('main');
    expect(out.message).toBe('feat: adicionar novo.txt');
    expect(git('log', '-1', '--pretty=format:%s')).toBe('feat: adicionar novo.txt');
  });

  it('git_commit com authorName/authorEmail sobrescreve identidade', async () => {
    writeFileSync(join(dir, 'b.txt'), 'b\n');
    const res = await gitCommitTool.handler(
      {
        message: 'chore: arquivo b',
        stageAll: true,
        authorName: 'Override Author',
        authorEmail: 'override@test.dev',
      },
      ctx(),
    );
    expect(res.success).toBe(true);
    const out = res.output as { hash: string };
    expect(out.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(git('log', '-1', '--pretty=format:%an')).toBe('Override Author');
  });

  // ---------------------------------------------------------------------------
  // git_checkout_branch
  // ---------------------------------------------------------------------------

  it('git_checkout_branch cria nova branch (create=true)', async () => {
    const res = await gitCheckoutBranchTool.handler(
      { name: 'feature/test', create: true },
      ctx(),
    );
    expect(res.success).toBe(true);
    const out = res.output as { branch: string; created: boolean };
    expect(out.branch).toBe('feature/test');
    expect(out.created).toBe(true);
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/test');
    execFileSync('git', ['checkout', 'main'], { cwd: dir, stdio: 'ignore' });
  });

  it('git_checkout_branch muda para branch existente', async () => {
    execFileSync('git', ['checkout', '-b', 'aux-branch'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['checkout', 'main'], { cwd: dir, stdio: 'ignore' });

    const res = await gitCheckoutBranchTool.handler({ name: 'aux-branch' }, ctx());
    expect(res.success).toBe(true);
    const out = res.output as { branch: string; created: boolean };
    expect(out.branch).toBe('aux-branch');
    expect(out.created).toBe(false);
    execFileSync('git', ['checkout', 'main'], { cwd: dir, stdio: 'ignore' });
  });

  it('git_checkout_branch rejeita ref com hífen inicial (injeção de opção)', async () => {
    const res = await gitCheckoutBranchTool.handler({ name: '-b-malicious' }, ctx());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/inválida/);
  });

  // ---------------------------------------------------------------------------
  // git_restore
  // ---------------------------------------------------------------------------

  it('git_restore descarta alteração na working tree', async () => {
    writeFileSync(join(dir, 'a.txt'), 'linha 1\nLINHA MODIFICADA\n');
    const res = await gitRestoreTool.handler({ paths: ['a.txt'] }, ctx());
    expect(res.success).toBe(true);
    const out = res.output as { restored: number };
    expect(out.restored).toBe(1);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('linha 1\n');
  });

  it('git_restore --staged desfaz stage sem alterar working tree', async () => {
    writeFileSync(join(dir, 'staged.txt'), 'staged content\n');
    execFileSync('git', ['add', 'staged.txt'], { cwd: dir, stdio: 'ignore' });

    const statusBefore = execFileSync('git', ['status', '--short'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(statusBefore).toContain('A  staged.txt');

    const res = await gitRestoreTool.handler({ paths: ['staged.txt'], staged: true }, ctx());
    expect(res.success).toBe(true);

    const statusAfter = execFileSync('git', ['status', '--short'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(statusAfter).toContain('?? staged.txt');
  });

  // ---------------------------------------------------------------------------
  // git_revert
  // ---------------------------------------------------------------------------

  it('git_revert cria novo commit que desfaz o anterior', async () => {
    writeFileSync(join(dir, 'revert-me.txt'), 'conteúdo para reverter\n');
    execFileSync('git', ['add', 'revert-me.txt'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'feat: adicionar revert-me.txt'], {
      cwd: dir,
      stdio: 'ignore',
    });
    const targetHash = git('rev-parse', 'HEAD');

    const res = await gitRevertTool.handler({ commit: targetHash }, ctx());
    expect(res.success).toBe(true);
    const out = res.output as { hash: string; message: string };
    expect(out.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(out.hash).not.toBe(targetHash);
    expect(out.message).toMatch(/^Revert/i);
    expect(git('rev-parse', 'HEAD')).toBe(out.hash);
  });

  it('git_revert rejeita commit com hífen inicial', async () => {
    const res = await gitRevertTool.handler({ commit: '--abort' }, ctx());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/inválida/);
  });
});
