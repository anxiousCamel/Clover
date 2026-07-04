/**
 * abi — A ponte Zod→Tool ABI: valida entrada, valida saída, e emite um
 * descriptor com JSON Schema enxuto (sem `$schema`/`definitions`).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ToolInvocation } from '@clover/contracts';

import { defineZodTool, toJsonSchema } from '../src/abi.js';

function ctx(): ToolInvocation {
  return {
    taskId: 't',
    traceId: 't',
    workspacePath: '/tmp',
    token: { id: 't', taskId: 't', caps: [], issuedAt: 0, expiresAt: 0, sig: 't' },
    emit: () => {},
  };
}

const doubler = defineZodTool({
  name: 'doubler',
  description: 'dobra n',
  input: z.object({ n: z.number() }).strict(),
  output: z.object({ doubled: z.number() }),
  run: (args) => ({ doubled: args.n * 2 }),
});

describe('defineZodTool', () => {
  it('emite descriptor com JSON Schema enxuto', () => {
    const s = doubler.descriptor.inputSchema as Record<string, unknown>;
    expect(doubler.descriptor.name).toBe('doubler');
    expect(s.type).toBe('object');
    expect(s.$schema).toBeUndefined();
    expect(s.definitions).toBeUndefined();
    expect(doubler.descriptor.pure).toBe(false); // default real-tool
  });

  it('args válidos → success + output validado', async () => {
    const r = await doubler.handler({ n: 21 }, ctx());
    expect(r.success).toBe(true);
    expect(r.output).toEqual({ doubled: 42 });
  });

  it('args fora do schema → erro estruturado (não exceção)', async () => {
    const r = await doubler.handler({ n: 'x' }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/args inválidos/);
  });

  it('campo extra rejeitado (strict)', async () => {
    const r = await doubler.handler({ n: 1, extra: true }, ctx());
    expect(r.success).toBe(false);
  });

  it('output inválido da implementação → erro de output (bug da tool)', async () => {
    const broken = defineZodTool({
      name: 'broken',
      description: 'retorna shape errada',
      input: z.object({}).strict(),
      output: z.object({ x: z.number() }),
      // @ts-expect-error: forçando saída inválida para o teste
      run: () => ({ x: 'not-a-number' }),
    });
    const r = await broken.handler({}, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/output inválido/);
  });

  it('exceção na implementação vira ToolResult de erro', async () => {
    const boom = defineZodTool({
      name: 'boom',
      description: 'explode',
      input: z.object({}).strict(),
      output: z.object({}),
      run: () => {
        throw new Error('kaboom');
      },
    });
    const r = await boom.handler({}, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toBe('kaboom');
  });
});

describe('toJsonSchema', () => {
  it('remove $schema e mantém propriedades', () => {
    const js = toJsonSchema(z.object({ a: z.string() }).strict()) as Record<string, unknown>;
    expect(js.$schema).toBeUndefined();
    expect((js.properties as Record<string, unknown>).a).toBeDefined();
  });
});
