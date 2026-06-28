import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { Blackboard } from '@clover/blackboard';

const tmpFiles: string[] = [];
function tmpFile(): string {
  const f = join(tmpdir(), `clover-bb-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
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

describe('Blackboard', () => {
  it('posts entries with per-topic incremental versions', () => {
    const bb = new Blackboard();
    const a = bb.post({ topic: 'plan', author: 'planner', payload: { step: 1 } });
    const b = bb.post({ topic: 'plan', author: 'planner', payload: { step: 2 } });
    const c = bb.post({ topic: 'exec', author: 'executor', payload: {} });
    expect(a.version).toBe(1);
    expect(b.version).toBe(2);
    expect(c.version).toBe(1); // tópico diferente reinicia a versão
    expect(bb.latest('plan')?.version).toBe(2);
  });

  it('queries by topic/author/taskId', () => {
    const bb = new Blackboard();
    bb.post({ topic: 'x', author: 'a1', payload: 1, taskId: 't1' });
    bb.post({ topic: 'x', author: 'a2', payload: 2, taskId: 't2' });
    expect(bb.query({ topic: 'x' })).toHaveLength(2);
    expect(bb.query({ author: 'a1' })).toHaveLength(1);
    expect(bb.query({ taskId: 't2' })[0].author).toBe('a2');
  });

  it('notifies matching subscribers only', () => {
    const bb = new Blackboard();
    const seen: string[] = [];
    bb.subscribe({ topic: 'alerts' }, (e) => seen.push(String(e.payload)));
    bb.post({ topic: 'alerts', author: 's', payload: 'boom' });
    bb.post({ topic: 'other', author: 's', payload: 'ignored' });
    expect(seen).toEqual(['boom']);
  });

  it('persists to JSONL and reloads (recovery)', () => {
    const file = tmpFile();
    const a = new Blackboard({ filePath: file });
    a.post({ topic: 'crash', author: 'kernel', payload: { reason: 'oom' } });
    const b = new Blackboard({ filePath: file });
    expect(b.size).toBe(1);
    expect(b.latest('crash')?.payload).toEqual({ reason: 'oom' });
  });

  it('reports stats for /status', () => {
    const bb = new Blackboard();
    bb.post({ topic: 'plan', author: 'planner', payload: 1 });
    bb.post({ topic: 'exec', author: 'executor', payload: 1 });
    const s = bb.stats();
    expect(s.entries).toBe(2);
    expect(s.topics).toEqual(['exec', 'plan']);
    expect(s.authors).toEqual(['executor', 'planner']);
  });
});
