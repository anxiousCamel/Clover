/**
 * Durable state — prova de que o journal append-only é a fonte da verdade e que
 * o estado das tasks é reconstruível por replay (ADR-005). Inclui persistência
 * em JSONL (reabre o arquivo) e a integração Kernel → journal → projeção.
 */

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { EventEnvelope, PlanIR } from '@clover/contracts';
import { createKernel, demoTools } from '@clover/kernel';
import {
  EventStore,
  SnapshotStore,
  projectTasks,
  recordBusToStore,
} from '@clover/state';

const tmpFiles: string[] = [];
function tmpFile(ext = 'jsonl'): string {
  const f = join(tmpdir(), `clover-state-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  tmpFiles.push(f);
  return f;
}
afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try {
      rmSync(f, { force: true });
    } catch {
      /* ignore */
    }
  }
});

function helloWorldPlan(): PlanIR {
  return {
    version: '1',
    goalId: 'demo',
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

const evt = (topic: string, payload: unknown): EventEnvelope => ({
  id: Math.random().toString(36).slice(2),
  topic,
  traceId: 't',
  ts: Date.now(),
  source: 'test',
  payload,
});

describe('event store', () => {
  it('appends and reads back in order', () => {
    const store = new EventStore();
    store.append(evt('a', 1));
    store.append(evt('b', 2));
    expect(store.length).toBe(2);
    expect(store.read().map((e) => e.topic)).toEqual(['a', 'b']);
    expect(store.read(1).map((e) => e.topic)).toEqual(['b']);
  });

  it('persists to JSONL and reloads from disk (durability)', () => {
    const file = tmpFile();
    const a = new EventStore({ filePath: file });
    a.append(evt('task:submitted', { taskId: 'x' }));
    a.append(evt('plan:done', { taskId: 'x', outputs: ['ok'] }));

    // Novo store sobre o mesmo arquivo: o journal sobrevive ao "restart".
    const b = new EventStore({ filePath: file });
    expect(b.length).toBe(2);
    expect(b.read().map((e) => e.topic)).toEqual(['task:submitted', 'plan:done']);
  });
});

describe('snapshots', () => {
  it('round-trips in memory and on disk', () => {
    const dir = tmpFile('d');
    const store = new SnapshotStore(dir);
    store.save({ taskId: 'x', state: { step: 2 }, offset: 5, ts: 1 });

    expect(store.load('x')?.state).toEqual({ step: 2 });
    // Outra instância lê do disco.
    expect(new SnapshotStore(dir).load('x')?.offset).toBe(5);
  });
});

describe('kernel integration + projection (replay)', () => {
  it('captures the timeline and reconstructs task status from the journal', async () => {
    const kernel = createKernel(demoTools);
    const store = new EventStore();
    recordBusToStore(kernel.events, store);

    const result = await kernel.submitPlan(helloWorldPlan());
    expect(result.status).toBe('done');

    const topics = store.read().map((e) => e.topic);
    expect(topics).toContain('task:submitted');
    expect(topics).toContain('plan:done');

    // Recuperação PURAMENTE por replay: serializa o journal e projeta do zero.
    const replayed = JSON.parse(JSON.stringify(store.read())) as EventEnvelope[];
    const tasks = projectTasks(replayed);
    const t = tasks.get(result.taskId);
    expect(t?.status).toBe('done');
    expect(t?.completedNodes).toEqual(['n1', 'n2']);
    expect(t?.outputs).toEqual(['hello world']);
  });

  it('projects a failed task from the journal', async () => {
    const kernel = createKernel(demoTools);
    const store = new EventStore();
    recordBusToStore(kernel.events, store);

    const badPlan: PlanIR = {
      version: '1',
      goalId: 'g',
      nodes: [{ kind: 'tool_call', id: 'n1', tool: 'echo', args: { text: 'hi' } }],
      edges: [],
      outputs: [{ kind: 'ref', nodeId: 'missing', path: 'text' }],
    };
    const result = await kernel.submitPlan(badPlan);
    expect(result.status).toBe('failed');

    const t = projectTasks(store.read()).get(result.taskId);
    expect(t?.status).toBe('failed');
  });
});
