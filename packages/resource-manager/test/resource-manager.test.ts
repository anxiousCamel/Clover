/**
 * Resource Manager — concorrência limitada, timeout e orçamento + Governor.
 */

import { describe, expect, it } from 'vitest';

import {
  Budget,
  ExecutionGovernor,
  ResourceManager,
  Semaphore,
  TimeoutError,
  withTimeout,
  type AuditEntry,
  type AuthContext,
} from '@clover/resource-manager';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Semaphore', () => {
  it('never exceeds the concurrency limit', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const task = async () => {
      await sem.acquire();
      active++;
      peak = Math.max(peak, active);
      await sleep(5);
      active--;
      sem.release();
    };
    await Promise.all(Array.from({ length: 8 }, task));
    expect(peak).toBe(2);
  });

  it('run() releases the slot even on error', async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    // Se o slot não fosse liberado, este run travaria.
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('withTimeout', () => {
  it('resolves fast promises', async () => {
    await expect(withTimeout(Promise.resolve(42), 50)).resolves.toBe(42);
  });
  it('rejects slow promises with TimeoutError', async () => {
    await expect(withTimeout(sleep(50).then(() => 1), 5, 'slow')).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('Budget', () => {
  it('consumes within the limit and refuses overflow without consuming', () => {
    const b = new Budget(10);
    expect(b.tryConsume(6)).toBe(true);
    expect(b.remaining).toBe(4);
    expect(b.tryConsume(5)).toBe(false); // estouraria → recusa
    expect(b.remaining).toBe(4); // não consumiu
    expect(b.tryConsume(4)).toBe(true);
    expect(b.remaining).toBe(0);
  });
});

describe('ResourceManager', () => {
  it('serializes execution under maxConcurrent=1', async () => {
    const rm = new ResourceManager({ maxConcurrent: 1 });
    const order: string[] = [];
    const job = (id: string) => async () => {
      order.push(`start:${id}`);
      await sleep(5);
      order.push(`end:${id}`);
      return id;
    };
    await Promise.all([rm.run(job('a')), rm.run(job('b'))]);
    // Com 1 slot, 'a' termina antes de 'b' começar.
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });
});

// ===========================================================================
// ExecutionGovernor
// ===========================================================================

const readCtx: AuthContext = { tool: 'git_status', intent: 'read', taskId: 'T', traceId: 'TR', args: {} };
const writeCtx: AuthContext = { tool: 'write_file', intent: 'write', taskId: 'T', traceId: 'TR', args: {} };

describe('ExecutionGovernor', () => {
  it('read intent passes immediately without audit', async () => {
    const entries: AuditEntry[] = [];
    const gov = new ExecutionGovernor({ audit: (e) => entries.push(e) });
    const d = await gov.authorize(readCtx);
    expect(d.allowed).toBe(true);
    expect(entries).toHaveLength(0);
  });

  it('write in step mode, no prompt → denied (fail-safe)', async () => {
    const entries: AuditEntry[] = [];
    const gov = new ExecutionGovernor({ mode: 'step', audit: (e) => entries.push(e) });
    const d = await gov.authorize(writeCtx);
    expect(d.allowed).toBe(false);
    expect(entries).toHaveLength(1);
    expect(entries[0].decision).toBe('denied');
    expect(entries[0].mode).toBe('step');
  });

  it('write in step mode, prompt returns false → denied + audited', async () => {
    const entries: AuditEntry[] = [];
    const gov = new ExecutionGovernor({ mode: 'step', prompt: () => false, audit: (e) => entries.push(e) });
    const d = await gov.authorize(writeCtx);
    expect(d.allowed).toBe(false);
    expect(entries[0].decision).toBe('denied');
    expect(entries[0].reason).toBe('reprovado pelo usuário');
  });

  it('write in step mode, prompt returns true → allowed + audited', async () => {
    const entries: AuditEntry[] = [];
    const gov = new ExecutionGovernor({ mode: 'step', prompt: () => true, audit: (e) => entries.push(e) });
    const d = await gov.authorize(writeCtx);
    expect(d.allowed).toBe(true);
    expect(entries[0].decision).toBe('allowed');
    expect(entries[0].tool).toBe('write_file');
  });

  it('write in auto mode → allowed + audited with mode=auto', async () => {
    const entries: AuditEntry[] = [];
    const gov = new ExecutionGovernor({ mode: 'auto', audit: (e) => entries.push(e) });
    const d = await gov.authorize(writeCtx);
    expect(d.allowed).toBe(true);
    expect(entries[0].decision).toBe('allowed');
    expect(entries[0].mode).toBe('auto');
  });

  it('audit entry carries injected clock and full context', async () => {
    const entries: AuditEntry[] = [];
    const gov = new ExecutionGovernor({ mode: 'auto', audit: (e) => entries.push(e), now: () => 42_000 });
    const ctx: AuthContext = { tool: 'patch_file', intent: 'write', taskId: 'T6', traceId: 'TR6', args: { path: 'x' } };
    await gov.authorize(ctx);
    const e = entries[0];
    expect(e.ts).toBe(42_000);
    expect(e.tool).toBe('patch_file');
    expect(e.taskId).toBe('T6');
    expect(e.traceId).toBe('TR6');
    expect(e.intent).toBe('write');
  });

  it('async prompt is awaited (Promise<boolean>)', async () => {
    const gov = new ExecutionGovernor({ mode: 'step', prompt: () => Promise.resolve(true) });
    const d = await gov.authorize(writeCtx);
    expect(d.allowed).toBe(true);
  });

  it('guard rejects slow calls with TimeoutError', async () => {
    const gov = new ExecutionGovernor({ perToolTimeoutMs: 10 });
    const slow = () => new Promise<string>((r) => setTimeout(() => r('done'), 200));
    await expect(gov.guard(slow)).rejects.toBeInstanceOf(TimeoutError);
  });

  it('guard passes through fast calls', async () => {
    const gov = new ExecutionGovernor({ perToolTimeoutMs: 5_000 });
    await expect(gov.guard(() => Promise.resolve('fast'))).resolves.toBe('fast');
  });

  it('guard with no timeout is a transparent passthrough', async () => {
    const gov = new ExecutionGovernor({});
    await expect(gov.guard(() => Promise.resolve(99))).resolves.toBe(99);
  });
});
