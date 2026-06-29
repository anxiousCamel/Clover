/**
 * Planner — prova de que a geração restrita (LLM→IR) produz planos válidos e
 * se recupera de saídas inválidas, de forma determinística (MockProvider).
 *
 * Inclui o end-to-end Planner → Kernel: o plano gerado é executado de fato.
 */

import { describe, expect, it } from 'vitest';

import type { Goal, ToolDescriptor } from '@clover/contracts';
import { MockProvider } from '@clover/llm';
import { createKernel, demoTools } from '@clover/kernel';
import { Planner, PlanningError, buildPlanSchema, tryParseJson } from '@clover/planner';

const tools: ToolDescriptor[] = demoTools.map((t) => t.descriptor);
const goal: Goal = { id: 'g1', text: 'diga hello world', workspacePath: '/tmp' };

const VALID_PLAN = JSON.stringify({
  version: '1',
  goalId: 'ignored',
  nodes: [
    { kind: 'tool_call', id: 'n1', tool: 'echo', args: { text: 'hello' } },
    {
      kind: 'tool_call',
      id: 'n2',
      tool: 'concat',
      args: { a: { kind: 'ref', nodeId: 'n1', path: 'text' }, b: ' world' },
    },
  ],
  edges: [],
  outputs: [{ kind: 'ref', nodeId: 'n2', path: 'text' }],
});

const UNKNOWN_TOOL_PLAN = JSON.stringify({
  version: '1',
  goalId: 'x',
  nodes: [{ kind: 'tool_call', id: 'n1', tool: 'frobnicate', args: {} }],
  edges: [],
  outputs: [{ kind: 'ref', nodeId: 'n1', path: 'text' }],
});

describe('planner: constrained generation (LLM -> IR)', () => {
  it('buildPlanSchema constrains the tool field to available tool names', () => {
    const schema = buildPlanSchema(tools) as Record<string, any>;
    const toolEnum = schema.properties.nodes.items.properties.tool.enum;
    expect(new Set(toolEnum)).toEqual(new Set(['echo', 'concat']));
    expect(schema.properties.version.const).toBe('1');
  });

  it('produces a valid PlanIR and fixes the goalId authoritatively', async () => {
    const planner = new Planner(new MockProvider(VALID_PLAN));
    const plan = await planner.plan(goal, tools);
    expect(plan.goalId).toBe('g1'); // sobrescreve o que o modelo "disse"
    expect(plan.nodes).toHaveLength(2);
  });

  it('end-to-end: planned IR executes on the kernel to "hello world"', async () => {
    const planner = new Planner(new MockProvider(VALID_PLAN));
    const plan = await planner.plan(goal, tools);

    const kernel = createKernel(demoTools);
    const result = await kernel.submitPlan(plan);

    expect(result.status).toBe('done');
    expect(result.outputs).toEqual(['hello world']);
  });

  it('repairs after an invalid plan (unknown tool) then succeeds', async () => {
    const provider = new MockProvider([UNKNOWN_TOOL_PLAN, VALID_PLAN]);
    const planner = new Planner(provider, { maxAttempts: 2 });

    const plan = await planner.plan(goal, tools);
    expect(plan.nodes).toHaveLength(2);
    expect(provider.requests).toHaveLength(2); // precisou de um reparo
    // O prompt de reparo carregou o motivo da rejeição.
    expect(provider.requests[1].prompt).toContain('frobnicate');
  });

  it('throws PlanningError when the model never returns valid JSON', async () => {
    const planner = new Planner(new MockProvider(['not json {{{', 'still not json']), {
      maxAttempts: 2,
    });
    await expect(planner.plan(goal, tools)).rejects.toBeInstanceOf(PlanningError);
  });

  it('tryParseJson strips markdown fences', () => {
    const r = tryParseJson('```json\n{"a":1}\n```');
    expect(r.ok && r.value).toEqual({ a: 1 });
  });
});
