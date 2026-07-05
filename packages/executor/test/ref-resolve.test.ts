/**
 * Testes de regressão para resolução de IRRef (bindings).
 *
 * Cobre: path vazio, segmento vazio, path com trailing dot, e o erro
 * "segmento sobre valor nulo" que causava crash no REPL.
 */

import { describe, expect, it } from 'vitest';

import { resolveValue } from '../src/index.js';

describe('resolveValue — regressão de ref/path', () => {
  const outputs: Record<string, unknown> = {
    n1: { message: 'hello' },
    n2: [1, 2, 3],
    n3: { files: [{ name: 'a.txt' }, { name: 'b.txt' }] },
  };

  it('path vazio ou ausente → retorna o output inteiro', () => {
    const result = resolveValue({ kind: 'ref', nodeId: 'n1', path: '' }, outputs);
    expect(result).toEqual({ message: 'hello' });
  });

  it('path undefined → retorna o output inteiro', () => {
    const result = resolveValue({ kind: 'ref', nodeId: 'n1' }, outputs);
    expect(result).toEqual({ message: 'hello' });
  });

  it('path com trailing dot → resolve corretamente (ignora segmento vazio)', () => {
    const result = resolveValue({ kind: 'ref', nodeId: 'n1', path: '.' }, outputs);
    expect(result).toEqual({ message: 'hello' });
  });

  it('path normal → resolve por pontos', () => {
    const result = resolveValue({ kind: 'ref', nodeId: 'n1', path: 'message' }, outputs);
    expect(result).toBe('hello');
  });

  it('path com índice de array → resolve corretamente', () => {
    const result = resolveValue({ kind: 'ref', nodeId: 'n3', path: 'files.0.name' }, outputs);
    expect(result).toBe('a.txt');
  });

  it('path com segmento sobre valor nulo → erro estruturado', () => {
    expect(() => resolveValue({ kind: 'ref', nodeId: 'n1', path: 'inexistente.atributo' }, outputs)).toThrow(
      /nulo|undefined/,
    );
  });

  it('ref para nó inexistente → erro estruturado', () => {
    expect(() => resolveValue({ kind: 'ref', nodeId: 'naoExiste' }, outputs)).toThrow(
      /não executou|ref não resolvida/,
    );
  });
});