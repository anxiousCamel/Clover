/**
 * Fluxo completo, ponta-a-ponta (RAP §13): Context Builder → Planner → Scheduler
 * sob Resource Manager. Comprova:
 *   - o fluxo "respira" de uma meta até um resultado executado e persistido;
 *   - **isolamento do Actor Model**: muitas metas em paralelo, cada uma com
 *     resultado próprio, sem cross-talk;
 *   - **Event Bus sincronizado**: todos os eventos passam por um único bus,
 *     atribuídos por taskId, e o journal reconstrói N tasks independentes;
 *   - **governança**: o Resource Manager limita a concorrência real.
 */

import { describe, expect, it } from 'vitest';

import type { Goal } from '@clover/contracts';
import { defineTool, type LocalTool } from '@clover/tool-abi';
import { createKernel } from '@clover/kernel';
import { DurableScheduler } from '@clover/scheduler';
import { EventStore, projectTasks } from '@clover/state';
import { MockProvider } from '@clover/llm';
import { Planner } from '@clover/planner';
import { ContextBuilder } from '@clover/context-builder';
import { ResourceManager } from '@clover/resource-manager';
import { LexicalToolSearch } from '@clover/tool-search';
import { ActorSystem } from '@clover/agent-runtime';
import { AstIndex } from '@clover/ast-index';
import { buildGraphFromIndex } from '@clover/knowledge-graph';
import { KnowledgeRetriever } from '@clover/knowledge-retriever';
import { Agent } from '@clover/agent';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ConcurrencyTracker {
  active: number;
  peak: number;
}

/** Tool instrumentada: ecoa o label e mede concorrência real. */
function makeWorkTool(tracker: ConcurrencyTracker): LocalTool {
  return defineTool(
    {
      name: 'work',
      description: 'executa um trabalho (work) e ecoa o label recebido',
      inputSchema: {
        type: 'object',
        properties: { label: { type: 'string' } },
        required: ['label'],
      },
      capabilities: [],
    },
    async (args) => {
      tracker.active++;
      tracker.peak = Math.max(tracker.peak, tracker.active);
      await sleep(25);
      tracker.active--;
      return { success: true, output: { text: String(args.label) } };
    },
  );
}

/** Provider que deriva o plano a partir da meta presente no prompt do Planner. */
function planFromGoalProvider(): MockProvider {
  return new MockProvider((req) => {
    const m = req.prompt.match(/Meta: (.+)/);
    const label = m ? m[1].trim() : 'unknown';
    return JSON.stringify({
      version: '1',
      goalId: 'x',
      nodes: [{ kind: 'tool_call', id: 'n1', tool: 'work', args: { label } }],
      edges: [],
      outputs: [{ kind: 'ref', nodeId: 'n1', path: 'text' }],
    });
  });
}

function buildAgent(tracker: ConcurrencyTracker, store: EventStore, maxConcurrent: number) {
  const kernel = createKernel([makeWorkTool(tracker)]);
  const scheduler = new DurableScheduler(kernel, store);
  const agent = new Agent({
    kernel,
    scheduler,
    planner: new Planner(planFromGoalProvider()),
    contextBuilder: new ContextBuilder(),
    resourceManager: new ResourceManager({ maxConcurrent }),
    toolSearch: new LexicalToolSearch(),
    budget: { maxTokens: 4096 },
    maxTools: 4,
  });
  return { kernel, scheduler, agent };
}

describe('agent end-to-end wiring', () => {
  it('flows a goal through context -> plan -> durable execution', async () => {
    const tracker: ConcurrencyTracker = { active: 0, peak: 0 };
    const store = new EventStore();
    const { agent } = buildAgent(tracker, store, 4);

    const goal: Goal = { id: 'g1', text: 'work task alpha', workspacePath: '/tmp' };
    const run = await agent.run(goal);

    expect(run.result.status).toBe('done');
    expect(run.result.outputs).toEqual(['work task alpha']); // saída ecoa a meta
    // Context Builder selecionou a tool relevante via Tool Search.
    expect(run.context.tools.map((t) => t.name)).toEqual(['work']);
    // Event Bus → journal: a task foi persistida e é reconstruível.
    expect(projectTasks(store.read()).get(run.taskId)?.status).toBe('done');
  });

  it('runs many goals as isolated actors with a synchronized bus and bounded concurrency', async () => {
    const tracker: ConcurrencyTracker = { active: 0, peak: 0 };
    const store = new EventStore();
    const { agent } = buildAgent(tracker, store, 2); // governança: no máx. 2 por vez

    const goals: Goal[] = [1, 2, 3, 4, 5].map((n) => ({
      id: `g${n}`,
      text: `work task ${n}`,
      workspacePath: '/tmp',
    }));

    const sys = new ActorSystem();
    for (const g of goals) {
      // Cada meta é um ator isolado; o estado do ator é o resultado da sua run.
      sys.spawn(g.id, null, async () => agent.run(g));
    }

    // Dispara todas concorrentemente.
    await Promise.all(goals.map((g) => sys.send(g.id, 'run')));

    // Isolamento: cada ator produziu o resultado da SUA meta (sem cross-talk).
    for (const g of goals) {
      const st = sys.getState<{ result: { status: string; outputs: unknown[] } }>(g.id);
      expect(st?.result.status).toBe('done');
      expect(st?.result.outputs).toEqual([g.text]);
    }

    // Governança do Resource Manager: houve concorrência, mas limitada a 2.
    expect(tracker.peak).toBeGreaterThan(1);
    expect(tracker.peak).toBeLessThanOrEqual(2);

    // Event Bus sincronizado: um único bus → journal → 5 tasks independentes.
    const projection = projectTasks(store.read());
    const done = [...projection.values()].filter((t) => t.status === 'done');
    expect(done).toHaveLength(5);
  });
});

describe('agent structural retrieval (AST/KG -> context -> planner)', () => {
  // Tool genérica que casa com a consulta (para o plano ter o que usar).
  const lookupTool: LocalTool = defineTool(
    {
      name: 'lookup',
      description: 'lookup describe symbol auth service login',
      inputSchema: { type: 'object' },
      capabilities: [],
    },
    () => ({ success: true, output: {} }),
  );

  function indexedRetriever(): KnowledgeRetriever {
    const index = new AstIndex();
    index.indexFile('src/auth.ts', 'export class AuthService { login(): void {} }');
    return new KnowledgeRetriever(index, buildGraphFromIndex(index));
  }

  function build(budgetTokens: number) {
    const captured: string[] = [];
    const provider = new MockProvider((req) => {
      captured.push(req.prompt);
      return JSON.stringify({
        version: '1',
        goalId: 'x',
        nodes: [{ kind: 'tool_call', id: 'n1', tool: 'lookup', args: {} }],
        edges: [],
        outputs: [],
      });
    });
    const kernel = createKernel([lookupTool]);
    const agent = new Agent({
      kernel,
      scheduler: new DurableScheduler(kernel, new EventStore()),
      planner: new Planner(provider),
      contextBuilder: new ContextBuilder(),
      resourceManager: new ResourceManager(),
      toolSearch: new LexicalToolSearch(),
      knowledge: { retriever: indexedRetriever(), maxSnippets: 5 },
      budget: { maxTokens: budgetTokens },
      maxTools: 4,
    });
    return { agent, captured };
  }

  it('feeds budget-approved structural context into the planner prompt', async () => {
    const { agent, captured } = build(4096);
    const goal: Goal = { id: 'g1', text: 'describe AuthService login', workspacePath: '/tmp' };
    const run = await agent.run(goal);

    expect(run.result.status).toBe('done');
    // O contexto estrutural recuperado entrou no orçamento...
    expect(run.context.selectedMemory.length).toBeGreaterThan(0);
    // ...e chegou ao prompt do Planner, com a estrutura (AuthService) e seu membro.
    expect(captured[0]).toContain('Contexto do código');
    expect(captured[0]).toContain('AuthService');
    expect(captured[0]).toContain('login');
  });

  it('respects the token budget: a tight budget drops the heavier structural context', async () => {
    // Orçamento que cabe consulta + tool, mas NÃO o snippet estrutural (mais pesado).
    const { agent, captured } = build(22);
    const goal: Goal = { id: 'g2', text: 'describe AuthService login', workspacePath: '/tmp' };
    const run = await agent.run(goal);

    expect(run.result.status).toBe('done'); // tool coube → plano válido
    expect(run.context.selectedMemory).toEqual([]); // estrutura não coube
    expect(captured[0]).not.toContain('Contexto do código');
  });
});
