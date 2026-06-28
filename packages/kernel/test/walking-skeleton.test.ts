/**
 * Walking Skeleton — prova de que o Kernel do CloverOS roda um Plan IR.
 *
 * Cobre a espinha ponta-a-ponta: contracts → IR validator → Tool ABI →
 * Execution Engine → Kernel, com resolução de bindings (IRRef), gate de
 * capability e eventos no Event Bus.
 */

import { describe, expect, it } from 'vitest';

import type { EventEnvelope, ExecEvent, PlanIR } from '@clover/contracts';
import { EventBus } from '@clover/event-bus';
import { ExecutionEngine } from '@clover/executor';
import { LocalToolBridge, ToolRegistry } from '@clover/tool-abi';
import { createKernel, demoTools, CapabilityResolver, Kernel } from '@clover/kernel';

/** Plano: echo "hello" → concat com " world" → output. */
function helloWorldPlan(): PlanIR {
  return {
    version: '1',
    goalId: 'demo-goal',
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
  };
}

describe('walking skeleton: kernel runs a Plan IR', () => {
  it('executes a 2-node DAG and resolves bindings to "hello world"', async () => {
    // Sem boot ansioso: assina antes e deixa submitPlan fazer o lazy-boot,
    // de modo que 'kernel:booted' seja observável.
    const kernel = new Kernel().registerTools(demoTools);

    const topics: string[] = [];
    kernel.events.subscribe('*', (e: EventEnvelope) => topics.push(e.topic));

    const result = await kernel.submitPlan(helloWorldPlan());

    expect(result.status).toBe('done');
    expect(result.outputs).toEqual(['hello world']);
    expect(result.nodeOutputs.n1).toEqual({ text: 'hello' });
    expect(result.nodeOutputs.n2).toEqual({ text: 'hello world' });

    // Observabilidade: a timeline esperada apareceu no Event Bus.
    expect(topics).toContain('kernel:booted');
    expect(topics).toContain('task:submitted');
    expect(topics).toContain('plan:start');
    expect(topics).toContain('plan:done');
    expect(topics.filter((t) => t === 'node:done')).toHaveLength(2);
    expect(topics).toContain('checkpoint');
  });

  it('emits node:done in dependency order (n1 before n2)', async () => {
    const kernel = createKernel(demoTools);
    const doneOrder: string[] = [];
    kernel.events.subscribe('node:done', (e: EventEnvelope<ExecEvent>) => {
      const p = e.payload as Extract<ExecEvent, { type: 'node:done' }>;
      doneOrder.push(p.nodeId);
    });

    await kernel.submitPlan(helloWorldPlan());
    expect(doneOrder).toEqual(['n1', 'n2']);
  });

  it('denies a tool not granted by the capability token (least privilege)', async () => {
    // Engine direto, com token que NÃO concede a tool 'echo'.
    const bus = new EventBus();
    const registry = new ToolRegistry();
    for (const t of demoTools) registry.register(t);
    const engine = new ExecutionEngine(new LocalToolBridge(registry), bus);

    const plan: PlanIR = {
      version: '1',
      goalId: 'g',
      nodes: [{ kind: 'tool_call', id: 'n1', tool: 'echo', args: { text: 'hi' } }],
      edges: [],
      outputs: [{ kind: 'ref', nodeId: 'n1', path: 'text' }],
    };

    const emptyToken = {
      id: 't',
      taskId: 'task',
      caps: [], // nenhuma capability de tool → deve negar
      issuedAt: Date.now(),
      expiresAt: Date.now() + 1000,
      sig: 'unsigned-dev',
    };

    const result = await engine.run(plan, emptyToken, {
      taskId: 'task',
      traceId: 'trace',
      workspacePath: process.cwd(),
    });

    expect(result.status).toBe('failed');
    expect(result.fault?.code).toBe('capability_denied');
  });

  it('rejects an invalid plan (ref to a non-existent node) at validation', async () => {
    const kernel = createKernel(demoTools);
    const badPlan: PlanIR = {
      version: '1',
      goalId: 'g',
      nodes: [{ kind: 'tool_call', id: 'n1', tool: 'echo', args: { text: 'hi' } }],
      edges: [],
      outputs: [{ kind: 'ref', nodeId: 'does-not-exist', path: 'text' }],
    };

    const result = await kernel.submitPlan(badPlan);
    expect(result.status).toBe('failed');
    expect(result.fault?.code).toBe('validation');
  });

  it('mints a least-privilege token covering exactly the referenced tools', () => {
    const resolver = new CapabilityResolver();
    const token = resolver.mint(helloWorldPlan(), 'task-x');
    const toolCaps = token.caps.filter((c) => c.kind === 'tool').map((c) => (c as { name: string }).name);
    expect(new Set(toolCaps)).toEqual(new Set(['echo', 'concat']));
  });
});
