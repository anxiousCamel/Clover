import { describe, expect, it, vi } from 'vitest';

import { Blackboard } from '@clover/blackboard';
import type { ConfigStore } from '@clover/config';
import { createI18n } from '@clover/i18n';
import type { Kernel } from '@clover/kernel';
import { ThemeManager, UsageCounter } from '@clover/tui';

import { ModelRegistry, ReplEngine, buildExecConfirmation, type AgentRunner } from '../src/repl-engine.js';
import type { ToolCallingAgent } from '../src/tool-agent.js';

const theme = new ThemeManager({ color: false, unicode: false });

function harness(agentRun: AgentRunner['run'], opts: { mode?: 'step' | 'auto'; lang?: 'en' | 'pt-BR' } = {}) {
  const out: string[] = [];
  const io = { render: (s: string) => out.push(s), clear: () => out.push('<<clear>>') };
  const bb = new Blackboard();
  bb.post({ topic: 'boot', author: 'kernel', payload: 1 });
  const models = new ModelRegistry(['m1', 'm2'], 'm1');
  const cfgState: Record<string, unknown> = {
    language: opts.lang ?? 'pt-BR',
    mode: opts.mode ?? 'step',
    activeProvider: 'ollama',
  };
  const config = {
    getValue: (k: string) => cfgState[k],
    set: (k: string, v: unknown) => {
      cfgState[k] = v;
    },
  } as unknown as Pick<ConfigStore, 'getValue' | 'set'>;

  const engine = new ReplEngine({
    theme,
    i18n: createI18n(opts.lang ?? 'pt-BR'),
    io,
    agent: { run: agentRun },
    kernel: { listTools: () => [{}, {}] as never[] },
    blackboard: bb,
    config,
    models,
    usage: new UsageCounter(),
    workspacePath: '/tmp',
    sessionId: 'test-session',
  });
  return { engine, out, models, bb, cfgState };
}

const doneRun =
  (capture?: (text: string) => void): AgentRunner['run'] =>
  async (goal) => {
    capture?.(goal.text);
    return mkResult(goal, 'done', ['olá mundo']);
  };

const failedRun: AgentRunner['run'] = async (goal) => mkResult(goal, 'failed', [], 'orçamento estourado');

function mkResult(goal: { id: string; text: string; workspacePath: string }, status: 'done' | 'failed', outputs: unknown[], faultMsg?: string) {
  return {
    goal,
    context: { messages: [], tools: [], tokensUsed: 0, provenance: [], selectedMemory: [], dropped: 0 },
    taskId: 't1',
    result: {
      taskId: 't1',
      status,
      outputs,
      nodeOutputs: {},
      ...(faultMsg ? { fault: { code: 'tool_error' as const, message: faultMsg } } : {}),
    },
  };
}

describe('ReplEngine slash commands', () => {
  it('/help lists the commands (incl. new /config /mode /provider)', async () => {
    const { engine, out } = harness(doneRun());
    await engine.handleLine('/help');
    const s = out.join('\n');
    expect(s).toContain('Comandos do REPL');
    expect(s).toContain('/config');
    expect(s).toContain('/mode');
    expect(s).toContain('/provider');
  });

  it('/status shows kernel tools, model, provider, mode and language', async () => {
    const { engine, out } = harness(doneRun());
    await engine.handleLine('/status');
    const s = out.join('\n');
    expect(s).toContain('Status do CloverOS');
    expect(s).toContain('2 tools');
    expect(s).toContain('m1');
    expect(s).toContain('Modo: step');
  });

  it('/model lists and switches', async () => {
    const { engine, out, models } = harness(doneRun());
    await engine.handleLine('/model');
    expect(out.join('\n')).toContain('m1 (ativo)');
    await engine.handleLine('/model m2');
    expect(models.current).toBe('m2');
    await engine.handleLine('/model nope');
    expect(out.join('\n')).toContain('não encontrado');
  });

  it('/clear clears and /exit signals exit', async () => {
    const { engine, out } = harness(doneRun());
    await engine.handleLine('/clear');
    expect(out).toContain('<<clear>>');
    expect((await engine.handleLine('/exit')).exit).toBe(true);
  });

  it('unknown command warns', async () => {
    const { engine, out } = harness(doneRun());
    await engine.handleLine('/frobnicate');
    expect(out.join('\n')).toContain('Comando desconhecido');
  });
});

describe('ReplEngine /mode (autonomy)', () => {
  it('switches mode and persists it to config', async () => {
    const { engine, out, cfgState } = harness(doneRun());
    await engine.handleLine('/mode auto');
    expect(cfgState.mode).toBe('auto');
    expect(out.join('\n')).toContain('Modo de autonomia: auto');
    await engine.handleLine('/mode bogus');
    expect(out.join('\n')).toContain('Modo inválido');
  });

  it('step mode reports failures as errors', async () => {
    const { engine, out } = harness(failedRun, { mode: 'step' });
    await engine.handleLine('faça algo');
    expect(out.join('\n')).toContain('Falhou: orçamento estourado');
  });

  it('auto mode suspends to the Blackboard and notifies (safety ceiling)', async () => {
    const { engine, out, bb } = harness(failedRun, { mode: 'auto' });
    await engine.handleLine('faça algo arriscado');
    expect(bb.query({ topic: 'task:suspended' })).toHaveLength(1);
    expect(out.join('\n')).toContain('Task suspensa');
  });
});

describe('ReplEngine i18n', () => {
  it('renders in English when the active language is en', async () => {
    const { engine, out } = harness(doneRun(), { lang: 'en' });
    await engine.handleLine('/help');
    expect(out.join('\n')).toContain('REPL commands');
  });
});

describe('ReplEngine task handling', () => {
  it('sends free text to the agent and renders the output', async () => {
    let captured = '';
    const { engine, out } = harness(doneRun((t) => (captured = t)));
    await engine.handleLine('faça algo útil');
    expect(captured).toBe('faça algo útil');
    expect(out.join('\n')).toContain('olá mundo');
  });

  it('intercepts file paths into clean tags before sending (preserved feature)', async () => {
    let captured = '';
    const { engine, out } = harness(doneRun((t) => (captured = t)));
    await engine.handleLine('analise ./src/index.ts agora');
    expect(captured).toBe('analise [arquivo: ./src/index.ts] agora');
    expect(out.join('\n')).toContain('Anexos detectados');
  });

  it('renders a clean error when the agent throws (step mode)', async () => {
    const { engine, out } = harness(async () => {
      throw new Error('planner explodiu');
    });
    await engine.handleLine('tarefa ruim');
    expect(out.join('\n')).toContain('Erro: planner explodiu');
  });
});

describe('ModelRegistry & exec confirmation', () => {
  it('manages models', () => {
    const m = new ModelRegistry(['a', 'b'], 'a');
    expect(m.setActive('b')).toBe(true);
    expect(m.current).toBe('b');
    expect(m.setActive('x')).toBe(false);
  });

  it('builds a contextual Tier-3 confirmation prompt', () => {
    const prompt = buildExecConfirmation('rm -rf build');
    expect(prompt.question).toContain('rm -rf build');
    expect(prompt.choices.map((c) => c.value)).toEqual(['once', 'always', 'cancel']);
  });
});

// ---------------------------------------------------------------------------
// Routing: toolAgent > chatProvider > Plan IR
// ---------------------------------------------------------------------------

function makeRoutingEngine(opts: {
  agentRun?: AgentRunner['run'];
  toolAgent?: Partial<ToolCallingAgent>;
  chatComplete?: (req: { system?: string; prompt: string }) => Promise<string>;
}) {
  const out: string[] = [];
  const io = { render: (s: string) => out.push(s), clear: () => {} };
  const bb = new Blackboard();
  const cfgState: Record<string, unknown> = { language: 'pt-BR', mode: 'step', activeProvider: 'ollama' };
  const config = {
    getValue: (k: string) => cfgState[k],
    set: (k: string, v: unknown) => { cfgState[k] = v; },
  } as unknown as Pick<ConfigStore, 'getValue' | 'set'>;

  const agentRun: AgentRunner['run'] = opts.agentRun ?? (async (goal) => ({
    goal,
    context: { messages: [], tools: [], tokensUsed: 0, provenance: [], selectedMemory: [], dropped: 0 },
    taskId: 't1',
    result: { taskId: 't1', status: 'done', outputs: ['plan-ir-response'], nodeOutputs: {} } as never,
  }));

  const engine = new ReplEngine({
    theme,
    i18n: createI18n('pt-BR'),
    io,
    agent: { run: agentRun },
    kernel: { listTools: () => [] } as unknown as Pick<Kernel, 'listTools'>,
    blackboard: bb,
    config,
    models: new ModelRegistry(['m'], 'm'),
    usage: new UsageCounter(),
    workspacePath: '/tmp',
    sessionId: 'routing-test',
    ...(opts.toolAgent ? { toolAgent: opts.toolAgent as unknown as ToolCallingAgent } : {}),
    ...(opts.chatComplete ? { chatProvider: { complete: opts.chatComplete } } : {}),
  });

  return { engine, out };
}

describe('ReplEngine routing', () => {
  it('uses toolAgent when supportsTools=true — Plan IR never called', async () => {
    const planIrCalls: string[] = [];
    const toolAgentCalls: string[] = [];

    const { engine, out } = makeRoutingEngine({
      agentRun: async (goal) => { planIrCalls.push(goal.text); return {} as never; },
      toolAgent: {
        supportsTools: true,
        run: async (text: string) => { toolAgentCalls.push(text); return 'resposta do toolAgent'; },
      },
    });

    await engine.handleLine('lista os arquivos');

    expect(toolAgentCalls).toHaveLength(1);
    expect(planIrCalls).toHaveLength(0);
    expect(out.join('\n')).toContain('resposta do toolAgent');
  });

  it('uses chatProvider when no toolAgent', async () => {
    const chatCalls: string[] = [];
    const planIrCalls: string[] = [];

    const { engine, out } = makeRoutingEngine({
      agentRun: async (goal) => { planIrCalls.push(goal.text); return {} as never; },
      chatComplete: async (req) => { chatCalls.push(req.prompt); return 'resposta do chat'; },
    });

    await engine.handleLine('oi tudo bem?');

    expect(chatCalls).toHaveLength(1);
    expect(planIrCalls).toHaveLength(0);
    expect(out.join('\n')).toContain('resposta do chat');
  });

  it('falls back to Plan IR when no toolAgent and no chatProvider', async () => {
    const planIrCalls: string[] = [];

    const { engine, out } = makeRoutingEngine({
      agentRun: async (goal) => {
        planIrCalls.push(goal.text);
        return {
          goal,
          context: { messages: [], tools: [], tokensUsed: 0, provenance: [], selectedMemory: [], dropped: 0 },
          taskId: 't1',
          result: { taskId: 't1', status: 'done', outputs: ['plano executado'], nodeOutputs: {} } as never,
        };
      },
    });

    await engine.handleLine('tarefa qualquer');

    expect(planIrCalls).toHaveLength(1);
    expect(out.join('\n')).toContain('plano executado');
  });
});
