/**
 * git/ — Teste de integração REAL: cria um repositório git temporário, executa
 * as tools através do handler (com validação Zod) + Sandbox Tier 3, e verifica
 * a saída estruturada. Prova o caminho ponta-a-ponta no SO atual (incl. spawn
 * win32 com `shell:false` e env mínimo).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CapabilityToken, ToolInvocation } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';

import {
  gitBlameTool,
  gitBranchListTool,
  gitCurrentBranchTool,
  gitDiffTool,
  gitLogTool,
  gitShowFileTool,
  gitStatusTool,
} from '../src/git/index.js';

/** Há git no PATH? Se não, pulamos a suíte (em vez de falhar o build). */
function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_GIT = gitAvailable();

/** Token que concede apenas `proc.exec` para `git` (espelha o que o Kernel cunha). */
function tokenFor(): CapabilityToken {
  return {
    id: 'test-token',
    taskId: 'test-task',
    caps: [{ kind: 'proc.exec', argv0Allow: ['git'], maxProcs: 4 }],
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    sig: 'test',
  };
}

function ctxFor(workspacePath: string): ToolInvocation {
  return {
    taskId: 'test-task',
    traceId: 'test-trace',
    workspacePath,
    token: tokenFor(),
    emit: () => {},
  };
}

/** Invoca uma LocalTool como o Executor faria (handler + ctx). */
async function invoke(tool: LocalTool, args: Record<string, unknown>, ws: string) {
  return tool.handler(args, ctxFor(ws));
}

describe.skipIf(!HAS_GIT)('git/ tools (integração)', () => {
  let dir: string;
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'clover-git-'));
    git('-c', 'init.defaultBranch=main', 'init');
    git('config', 'user.email', 'test@clover.dev');
    git('config', 'user.name', 'Clover Test');
    writeFileSync(join(dir, 'a.txt'), 'linha um\nlinha dois\n');
    git('add', 'a.txt');
    git('commit', '-m', 'inicial');
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('git_status: árvore limpa após commit', async () => {
    const res = await invoke(gitStatusTool, {}, dir);
    expect(res.success).toBe(true);
    const out = res.output as { branch?: string; clean: boolean; files: unknown[]; truncated: boolean };
    expect(out.branch).toBe('main');
    expect(out.clean).toBe(true);
    expect(out.files).toHaveLength(0);
    expect(out.truncated).toBe(false);
  });

  it('git_current_branch: main, não detached', async () => {
    const res = await invoke(gitCurrentBranchTool, {}, dir);
    expect(res.success).toBe(true);
    expect(res.output).toEqual({ branch: 'main', detached: false });
  });

  it('git_log: contém o commit inicial com campos estruturados', async () => {
    const res = await invoke(gitLogTool, { maxCount: 10 }, dir);
    expect(res.success).toBe(true);
    const out = res.output as { commits: Array<{ subject: string; author: string; hash: string }> };
    expect(out.commits.length).toBeGreaterThanOrEqual(1);
    expect(out.commits[0].subject).toBe('inicial');
    expect(out.commits[0].author).toBe('Clover Test');
    expect(out.commits[0].hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('git_branch_list: lista main como current', async () => {
    const res = await invoke(gitBranchListTool, {}, dir);
    expect(res.success).toBe(true);
    const out = res.output as { branches: Array<{ name: string; current: boolean }> };
    expect(out.branches).toContainEqual({ name: 'main', current: true });
  });

  it('git_show_file: lê conteúdo de a.txt em HEAD', async () => {
    const res = await invoke(gitShowFileTool, { path: 'a.txt' }, dir);
    expect(res.success).toBe(true);
    const out = res.output as { content: string };
    expect(out.content).toContain('linha um');
  });

  it('git_blame: atribui linhas ao autor', async () => {
    const res = await invoke(gitBlameTool, { path: 'a.txt' }, dir);
    expect(res.success).toBe(true);
    const out = res.output as { lines: Array<{ author: string; content: string; line: number }> };
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0].author).toBe('Clover Test');
    expect(out.lines[0].content).toBe('linha um');
  });

  it('git_status: detecta modificado + untracked', async () => {
    writeFileSync(join(dir, 'a.txt'), 'linha um\nlinha dois\nlinha tres\n');
    writeFileSync(join(dir, 'b.txt'), 'novo\n');
    const res = await invoke(gitStatusTool, {}, dir);
    const out = res.output as { clean: boolean; files: Array<{ path: string; worktree: string }> };
    expect(out.clean).toBe(false);
    const paths = out.files.map((f) => f.path);
    expect(paths).toContain('a.txt');
    expect(paths).toContain('b.txt');
    expect(out.files.find((f) => f.path === 'b.txt')?.worktree).toBe('?');
  });

  it('git_diff: name-status estruturado + patch para o arquivo modificado', async () => {
    const res = await invoke(gitDiffTool, {}, dir);
    expect(res.success).toBe(true);
    const out = res.output as { files: Array<{ status: string; path: string }>; patch: string };
    expect(out.files).toContainEqual({ status: 'M', path: 'a.txt' });
    expect(out.patch).toContain('linha tres');
  });

  it('segurança: rejeita ref com injeção de opção (começa com -)', async () => {
    const res = await invoke(gitShowFileTool, { path: 'a.txt', ref: '--output=/tmp/x' }, dir);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/inválida/);
  });

  it('rejeita args fora do schema Zod', async () => {
    const res = await invoke(gitStatusTool, { bogus: 123 }, dir);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/args inválidos/);
  });
});
