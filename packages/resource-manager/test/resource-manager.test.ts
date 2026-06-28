/**
 * Resource Manager — concorrência limitada, timeout e orçamento.
 */

import { describe, expect, it } from 'vitest';

import { Budget, ResourceManager, Semaphore, TimeoutError, withTimeout } from '@clover/resource-manager';

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
