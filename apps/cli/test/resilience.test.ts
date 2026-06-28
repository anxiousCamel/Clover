import { describe, expect, it } from 'vitest';

import { ThemeManager } from '@clover/tui';

import { buildCrashHandler } from '../src/resilience.js';

const theme = new ThemeManager({ color: false, unicode: false });

function harness() {
  const posts: Array<{ topic: string; payload: unknown }> = [];
  const out: string[] = [];
  const exits: number[] = [];
  const handler = buildCrashHandler({
    blackboard: { post: (e) => posts.push(e) as never },
    theme,
    render: (s) => out.push(s),
    exit: (c) => exits.push(c),
  });
  return { handler, posts, out, exits };
}

describe('catastrophic resilience', () => {
  it('persists crash state to the blackboard and exits cleanly (no raw stack on screen)', () => {
    const { handler, posts, out, exits } = harness();
    handler('uncaughtException', new Error('boom'));

    // Persistiu para recovery (com stack no payload, não na tela).
    expect(posts).toHaveLength(1);
    expect(posts[0].topic).toBe('crash');
    expect((posts[0].payload as { message: string }).message).toBe('boom');
    expect((posts[0].payload as { stack?: string }).stack).toBeTruthy();

    // Saída polida, sem stack trace cru.
    const screen = out.join('\n');
    expect(screen).toContain('Erro fatal (uncaughtException)');
    expect(screen).toContain('boom');
    expect(screen).not.toMatch(/\n\s+at\s/); // nenhuma linha de stack "    at ..."

    expect(exits).toEqual([1]);
  });

  it('is re-entrancy safe (handles only the first crash)', () => {
    const { handler, posts, exits } = harness();
    handler('uncaughtException', new Error('first'));
    handler('unhandledRejection', new Error('second'));
    expect(posts).toHaveLength(1);
    expect(exits).toEqual([1]);
  });

  it('tolerates non-Error rejection values', () => {
    const { handler, posts } = harness();
    handler('unhandledRejection', 'just a string');
    expect((posts[0].payload as { message: string }).message).toBe('just a string');
  });
});
