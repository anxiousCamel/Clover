/**
 * Agent.runWithHeal — Loop de auto-cura (Fatia Arsenal #3).
 *
 * Prova que:
 *   1. Quando `run_build_and_test` retorna success=false, `runWithHeal` detecta
 *      a falha e re-planeja com o stderr como contexto.
 *   2. Se a segunda tentativa retorna success=true, o resultado final é done.
 *   3. O prompt do re-planejamento contém o erro de build (log legível ao Planner).
 *   4. Se maxAttempts=1, a falha é retornada sem retry.
 *
 * Usa um mock stateful de `run_build_and_test` (sem binários reais) e
 * MockProvider para controlar os planos gerados em cada tentativa.
 */

import { describe, expect, it } from 'vitest';

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

const WORKSPACE = '/tmp/heal-test';

/** Cria um mock de `run_build_and_test` com resultado configurável por chamada. */
function makeMockBuildTool(results: Array<{ success: boolean; stderr: string }>): {
  tool: LocalTool;
  calls: number;
} {
  let calls = 0;
  const tool = defineTool(
    {
      name: 'run_build_and_test',
      description: 'mock build tool',
      inputSchema: { type: 'object' },
      capabilities: [],
    },
    async () => {
      const idx = Math.min(calls, results.length - 1);
      const r = results[idx]!;
      calls++;
      return {
        success: true,
        output: {
          success: r.success,
          engine: 'pnpm',
          step: 'both',
          exitCode: r.success ? 0 : 1,
          stdout: '',
          stderr: r.stderr,
          truncated: false,
          failedCommand: r.success ? null : 'pnpm run test',
        },
      };
    },
  );
  return { tool, calls: 0 };
}

/** Provider que sempre retorna um plano com `run_build_and_test`. */
function buildPlanProvider(capturedPrompts: string[]): MockProvider {
  return new MockProvider((req) => {
    capturedPrompts.push(req.prompt);
    return JSON.stringify({
      version: '1',
      goalId: 'heal-goal',
      nodes: [{ kind: 'tool_call', id: 'n1', tool: 'run_build_and_test', args: {} }],
      edges: [],
      outputs: [{ kind: 'ref', nodeId: 'n1' }],
    });
  });
}

function buildAgent(buildTool: LocalTool, prompts: string[]) {
  const kernel = createKernel([buildTool]);
  const agent = new Agent({
    kernel,
    scheduler: new DurableScheduler(kernel, new EventStore()),
    planner: new Planner(buildPlanProvider(prompts)),
    contextBuilder: new ContextBuilder(),
    resourceManager: new ResourceManager(),
    toolSearch: new LexicalToolSearch(),
    budget: { maxTokens: 4096 },
    maxTools: 4,
  });
  return agent;
}

const goal: Goal = { id: 'g1', text: 'build e testar o projeto', workspacePath: WORKSPACE };

describe('Agent.runWithHeal', () => {
  it('sem falha de build → retorna na primeira tentativa sem retry', async () => {
    const prompts: string[] = [];
    const { tool } = makeMockBuildTool([{ success: true, stderr: '' }]);
    const agent = buildAgent(tool, prompts);

    const run = await agent.runWithHeal(goal);

    expect(run.result.status).toBe('done');
    // Planner chamado uma única vez.
    expect(prompts).toHaveLength(1);
  });

  it('falha na 1ª tentativa + sucesso na 2ª → done + Planner chamado 2×', async () => {
    const prompts: string[] = [];
    const { tool } = makeMockBuildTool([
      { success: false, stderr: 'error TS2345: Argument of type X...' },
      { success: true, stderr: '' },
    ]);
    const agent = buildAgent(tool, prompts);

    const run = await agent.runWithHeal(goal, { maxAttempts: 2 });

    expect(run.result.status).toBe('done');
    // Planner re-planejou.
    expect(prompts).toHaveLength(2);
  });

  it('o re-planejamento contém o stderr (log legível ao Planner)', async () => {
    const prompts: string[] = [];
    const { tool } = makeMockBuildTool([
      { success: false, stderr: 'error TS2345: meu erro específico de tipo' },
      { success: true, stderr: '' },
    ]);
    const agent = buildAgent(tool, prompts);

    await agent.runWithHeal(goal, { maxAttempts: 2 });

    // O 2º prompt deve conter o stderr do primeiro build falhado.
    expect(prompts[1]).toContain('meu erro específico de tipo');
    expect(prompts[1]).toContain('Auto-cura');
  });

  it('maxAttempts=1 → retorna falha sem retry', async () => {
    const prompts: string[] = [];
    const { tool } = makeMockBuildTool([
      { success: false, stderr: 'erro irreparável' },
    ]);
    const agent = buildAgent(tool, prompts);

    const run = await agent.runWithHeal(goal, { maxAttempts: 1 });

    // Status done (a tool executou, só retornou success=false no output).
    expect(run.result.status).toBe('done');
    // Planner chamado apenas uma vez (sem retry).
    expect(prompts).toHaveLength(1);
  });

  it('falha → output tem stderr legível (não binário, não vazio)', async () => {
    const prompts: string[] = [];
    const { tool } = makeMockBuildTool([
      { success: false, stderr: 'Cannot find module @clover/contracts' },
      { success: true, stderr: '' },
    ]);
    const agent = buildAgent(tool, prompts);

    const failRun = await agent.runWithHeal(goal, { maxAttempts: 1 });
    const out = failRun.result.outputs[0] as { success: boolean; stderr: string };

    expect(out.success).toBe(false);
    expect(typeof out.stderr).toBe('string');
    expect(out.stderr.length).toBeGreaterThan(0);
  });

  it('falha irreversível aciona onFinalFailure antes de retornar', async () => {
    const prompts: string[] = [];
    const { tool } = makeMockBuildTool([
      { success: false, stderr: 'erro irreparável de compilação' },
    ]);
    const agent = buildAgent(tool, prompts);

    let rolledBack = false;
    let rolledBackPath = '';

    const run = await agent.runWithHeal(goal, {
      maxAttempts: 1,
      onFinalFailure: async (workspacePath) => {
        rolledBack = true;
        rolledBackPath = workspacePath;
      },
    });

    // Retorna resultado (done, com output de build falhado).
    expect(run.result.status).toBe('done');
    // Rollback acionado antes de retornar.
    expect(rolledBack).toBe(true);
    expect(rolledBackPath).toBe(WORKSPACE);
    // Planner chamado apenas uma vez (sem retry com maxAttempts=1).
    expect(prompts).toHaveLength(1);
  });

  it('sucesso na 1ª tentativa NÃO aciona onFinalFailure', async () => {
    const prompts: string[] = [];
    const { tool } = makeMockBuildTool([{ success: true, stderr: '' }]);
    const agent = buildAgent(tool, prompts);

    let rolledBack = false;
    const run = await agent.runWithHeal(goal, {
      onFinalFailure: async () => { rolledBack = true; },
    });

    expect(run.result.status).toBe('done');
    expect(rolledBack).toBe(false);
  });
});
