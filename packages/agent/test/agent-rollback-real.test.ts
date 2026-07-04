/**
 * Agent.runWithHeal — rollback REAL via git_restore (mandato FASE 0).
 *
 * Os testes de `agent-heal` provam que o hook `onFinalFailure` dispara — mas com
 * um mock injetado. Aqui provamos o caminho DEFAULT: quando nenhum
 * `onFinalFailure` é injetado e a auto-cura esgota as tentativas, `defaultRollback`
 * chama `gitRestoreTool` (`git restore -- .`) contra um repositório git REAL,
 * descartando de fato as alterações da working tree.
 *
 * Skip automático se `git` não estiver no PATH (mesma degradação graciosa das
 * demais tools que dependem de binário externo).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Goal } from '@clover/contracts';
import { defineTool, type LocalTool } from '@clover/tool-abi';
import { createKernel } from '@clover/kernel';
import { DurableScheduler } from '@clover/scheduler';
import { EventStore } from '@clover/state';
import { MockProvider } from '@clover/llm';
import { Planner } from '@clover/planner';
import { ContextBuilder } from '@clover/context-builder';
import { ResourceManager } from '@clover/resource-manager';
import { LexicalToolSearch } from '@clover/tool-search';
import { Agent } from '@clover/agent';

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_GIT = gitAvailable();

/** Mock de `run_build_and_test` que SEMPRE falha (força o caminho de rollback). */
function failingBuildTool(): LocalTool {
  return defineTool(
    {
      name: 'run_build_and_test',
      description: 'mock build tool (sempre falha)',
      inputSchema: { type: 'object' },
      capabilities: [],
    },
    async () => ({
      success: true,
      output: {
        success: false,
        engine: 'pnpm',
        step: 'both',
        exitCode: 1,
        stdout: '',
        stderr: 'error: build falhou de propósito (teste de rollback)',
        truncated: false,
        failedCommand: 'pnpm run test',
      },
    }),
  );
}

function buildAgent(workspacePath: string): Agent {
  const kernel = createKernel([failingBuildTool()]);
  const provider = new MockProvider(() =>
    JSON.stringify({
      version: '1',
      goalId: 'rollback-goal',
      nodes: [{ kind: 'tool_call', id: 'n1', tool: 'run_build_and_test', args: {} }],
      edges: [],
      outputs: [{ kind: 'ref', nodeId: 'n1' }],
    }),
  );
  return new Agent({
    kernel,
    scheduler: new DurableScheduler(kernel, new EventStore()),
    planner: new Planner(provider),
    contextBuilder: new ContextBuilder(),
    resourceManager: new ResourceManager(),
    toolSearch: new LexicalToolSearch(),
    budget: { maxTokens: 4096 },
    maxTools: 4,
  });
}

describe.skipIf(!HAS_GIT)('Agent.runWithHeal — rollback real (git_restore)', () => {
  let dir: string;

  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clover-rollback-'));
    git('-c', 'init.defaultBranch=main', 'init');
    git('config', 'user.email', 'test@clover.dev');
    git('config', 'user.name', 'Clover Test');
    git('config', 'core.autocrlf', 'false');
    writeFileSync(join(dir, 'src.txt'), 'ORIGINAL\n');
    git('add', 'src.txt');
    git('commit', '-m', 'seed');
  });

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('falha irreversível SEM onFinalFailure → rollback total (restore tracked + clean untracked)', async () => {
    // Suja a working tree: modifica arquivo rastreado + cria lixo untracked
    // (simula sobras de uma tentativa de build falha).
    writeFileSync(join(dir, 'src.txt'), 'ALTERADO PELO AGENTE\n');
    writeFileSync(join(dir, 'garbage.txt'), 'lixo de tentativa falha\n');
    expect(existsSync(join(dir, 'garbage.txt'))).toBe(true);

    const goal: Goal = { id: 'g-rb', text: 'build e testar', workspacePath: dir };
    const agent = buildAgent(dir);

    // maxAttempts=1 → esgota na 1ª tentativa; sem onFinalFailure → defaultRollback.
    const run = await agent.runWithHeal(goal, { maxAttempts: 1 });

    // O resultado ainda é devolvido (o sinal de falha está no output do build).
    expect(run.result.status).toBe('done');
    // git restore reverteu o arquivo RASTREADO ao conteúdo commitado…
    expect(readFileSync(join(dir, 'src.txt'), 'utf8')).toBe('ORIGINAL\n');
    // …e git clean -fd removeu o UNTRACKED (rollback 100%).
    expect(existsSync(join(dir, 'garbage.txt'))).toBe(false);
  });

  it('build que passa NÃO aciona rollback (working tree preservada)', async () => {
    // Reescreve o arquivo e commita — nova baseline limpa.
    writeFileSync(join(dir, 'src.txt'), 'NOVA BASELINE\n');
    git('commit', '-am', 'update');
    // Suja de novo, mas o build passa → nada deve ser revertido.
    writeFileSync(join(dir, 'src.txt'), 'MUDANCA PRESERVADA\n');

    const kernel = createKernel([
      defineTool(
        { name: 'run_build_and_test', description: 'ok', inputSchema: { type: 'object' }, capabilities: [] },
        async () => ({
          success: true,
          output: { success: true, engine: 'pnpm', step: 'both', exitCode: 0, stdout: '', stderr: '', truncated: false, failedCommand: null },
        }),
      ),
    ]);
    const provider = new MockProvider(() =>
      JSON.stringify({
        version: '1', goalId: 'ok-goal',
        nodes: [{ kind: 'tool_call', id: 'n1', tool: 'run_build_and_test', args: {} }],
        edges: [], outputs: [{ kind: 'ref', nodeId: 'n1' }],
      }),
    );
    const agent = new Agent({
      kernel,
      scheduler: new DurableScheduler(kernel, new EventStore()),
      planner: new Planner(provider),
      contextBuilder: new ContextBuilder(),
      resourceManager: new ResourceManager(),
      toolSearch: new LexicalToolSearch(),
    });

    const goal: Goal = { id: 'g-ok', text: 'build e testar', workspacePath: dir };
    const run = await agent.runWithHeal(goal, { maxAttempts: 1 });

    expect(run.result.status).toBe('done');
    // Build passou → sem rollback → a mudança não-commitada permanece.
    expect(readFileSync(join(dir, 'src.txt'), 'utf8')).toBe('MUDANCA PRESERVADA\n');
  });
});
