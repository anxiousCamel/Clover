/**
 * Actor runtime — processamento sequencial, isolamento de estado e comunicação
 * entre atores.
 */

import { describe, expect, it } from 'vitest';

import { ActorSystem, UnknownActorError } from '@clover/agent-runtime';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ActorSystem', () => {
  it('processes messages sequentially, one at a time', async () => {
    const sys = new ActorSystem();
    const order: number[] = [];
    sys.spawn<number, number>('counter', 0, async (state, msg) => {
      // Atraso variável: se não fosse sequencial, a ordem embaralharia.
      await sleep(msg % 2 === 0 ? 5 : 1);
      order.push(msg);
      return state + 1;
    });

    await Promise.all([1, 2, 3, 4].map((n) => sys.send('counter', n)));
    expect(order).toEqual([1, 2, 3, 4]); // ordem de envio preservada
    expect(sys.getState<number>('counter')).toBe(4);
  });

  it('isolates state between actors', async () => {
    const sys = new ActorSystem();
    const beh = (state: number, msg: number) => state + msg;
    sys.spawn('a', 0, beh);
    sys.spawn('b', 100, beh);
    await sys.send('a', 1);
    await sys.send('a', 2);
    await sys.send('b', 5);
    expect(sys.getState('a')).toBe(3);
    expect(sys.getState('b')).toBe(105);
  });

  it('lets actors message other actors', async () => {
    const sys = new ActorSystem();
    sys.spawn<string, string[]>('sink', [], (state, msg) => [...state, msg]);
    sys.spawn<string, number>('relay', 0, (state, msg, ctx) => {
      ctx.send('sink', `relayed:${msg}`);
      return state + 1;
    });

    await sys.send('relay', 'hello');
    await sleep(5); // deixa a mensagem encaminhada ser processada
    expect(sys.getState<string[]>('sink')).toEqual(['relayed:hello']);
    expect(sys.getState<number>('relay')).toBe(1);
  });

  it('rejects sending to an unknown actor', async () => {
    const sys = new ActorSystem();
    await expect(sys.send('ghost', {})).rejects.toBeInstanceOf(UnknownActorError);
  });

  it('propagates behavior errors to the sender only', async () => {
    const sys = new ActorSystem();
    sys.spawn<string, number>('boomer', 0, (state, msg) => {
      if (msg === 'boom') throw new Error('kaboom');
      return state + 1;
    });
    await expect(sys.send('boomer', 'boom')).rejects.toThrow('kaboom');
    // O ator continua vivo e processa a próxima mensagem.
    await sys.send('boomer', 'ok');
    expect(sys.getState<number>('boomer')).toBe(1);
  });
});
