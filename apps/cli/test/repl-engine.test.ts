import { describe, expect, it } from 'vitest';

import { Blackboard } from '@clover/blackboard';
import { ThemeManager, UsageCounter } from '@clover/tui';

import { ModelRegistry, ReplEngine, buildExecConfirmation, type AgentRunner } from '../src/repl-engine.js';

const theme = new ThemeManager({ color: false, unicode: false });

function harness(agentRun: AgentRunner['run']) {
  const out: string[] = [];
  const io = {
    render: (s: string) => out.push(s),
    clear: () => out.push('<<clear>>'),
  };
  const bb = new Blackboard();
  bb.post({ topic: 'boot', author: 'kernel', payload: 1 });
  const models = new ModelRegistry(['m1', 'm2'], 'm1');
  const engine = new ReplEngine({
    theme,
    io,
    agent: { run: agentRun },
    kernel: { listTools: () => [{}, {}] as never[] },
    blackboard: bb,
    models,
    usage: new UsageCounter(),
    workspacePath: '/tmp',
  });
  return { engine, out, models };
}

const doneRun =
  (capture?: (text: string) => void): AgentRunner['run'] =>
  async (goal) => {
    capture?.(goal.text);
    return {
      goal,
      context: { messages: [], tools: [], tokensUsed: 0, provenance: [], selectedMemory: [], dropped: 0 },
      taskId: 't1',
      result: { taskId: 't1', status: 'done', outputs: ['olá mundo'], nodeOutputs: {} },
    };
  };

describe('ReplEngine slash commands', () => {
  it('/help lists the commands', async () => {
    const { engine, out } = harness(doneRun());
    await engine.handleLine('/help');
    expect(out.join('\n')).toContain('Comandos do REPL');
  });

  it('/status shows kernel tools, model and blackboard', async () => {
    const { engine, out } = harness(doneRun());
    await engine.handleLine('/status');
    const s = out.join('\n');
    expect(s).toContain('Status do CloverOS');
    expect(s).toContain('2 tools');
    expect(s).toContain('m1');
  });

  it('/model lists and switches the active model', async () => {
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
    const r = await engine.handleLine('/exit');
    expect(r.exit).toBe(true);
  });

  it('unknown command warns', async () => {
    const { engine, out } = harness(doneRun());
    await engine.handleLine('/frobnicate');
    expect(out.join('\n')).toContain('Comando desconhecido');
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

  it('intercepts file paths into clean tags before sending', async () => {
    let captured = '';
    const { engine, out } = harness(doneRun((t) => (captured = t)));
    await engine.handleLine('analise ./src/index.ts agora');
    expect(captured).toBe('analise [arquivo: ./src/index.ts] agora');
    expect(out.join('\n')).toContain('Anexos detectados');
  });

  it('renders a clean error when the agent throws', async () => {
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
    expect(m.list()).toEqual(['a', 'b']);
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
