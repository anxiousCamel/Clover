import { describe, expect, it } from 'vitest';

import { AstIndex } from '@clover/ast-index';
import { buildGraphFromIndex } from '@clover/knowledge-graph';
import { KnowledgeRetriever } from '@clover/knowledge-retriever';

function indexed(): AstIndex {
  const index = new AstIndex();
  index.indexFile(
    'src/auth.ts',
    `export class AuthService { login(): void {} logout(): void {} }
     export function unrelatedHelper() {}`,
  );
  index.indexFile('src/math.ts', 'export function add(a: number, b: number) { return a + b; }');
  return index;
}

describe('KnowledgeRetriever', () => {
  it('returns structural snippets ranked by relevance to the query', () => {
    const r = new KnowledgeRetriever(indexed());
    const out = r.retrieve('auth service login', 3);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].text).toContain('AuthService');
    expect(out[0].source).toBe('src/auth.ts:1');
    // não traz coisas irrelevantes no topo
    expect(out[0].text).not.toContain('add');
  });

  it('enriches class snippets with KG members', () => {
    const index = indexed();
    const graph = buildGraphFromIndex(index);
    const r = new KnowledgeRetriever(index, graph);
    const out = r.retrieve('AuthService', 1);
    expect(out[0].text).toContain('members:');
    expect(out[0].text).toContain('login');
  });

  it('respects topK and returns nothing for an unrelated query', () => {
    const r = new KnowledgeRetriever(indexed());
    expect(r.retrieve('add', 1).length).toBe(1);
    expect(r.retrieve('quantum chromodynamics', 5)).toEqual([]);
  });
});
