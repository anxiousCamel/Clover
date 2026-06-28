/**
 * Knowledge Graph — grafo embarcado + persistência JSONL + derivação do AST.
 */

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AstIndex } from '@clover/ast-index';
import { KnowledgeGraph, buildGraphFromIndex } from '@clover/knowledge-graph';

const tmpFiles: string[] = [];
function tmpFile(): string {
  const f = join(tmpdir(), `clover-kg-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
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

describe('KnowledgeGraph', () => {
  it('stores nodes/edges and queries neighbors by relation and direction', () => {
    const g = new KnowledgeGraph();
    g.upsertNode({ id: 'a', kind: 'file' });
    g.upsertNode({ id: 'b', kind: 'function' });
    g.upsertNode({ id: 'c', kind: 'module' });
    g.upsertEdge({ from: 'a', to: 'b', rel: 'contains' });
    g.upsertEdge({ from: 'a', to: 'c', rel: 'imports' });

    expect(g.nodeCount).toBe(3);
    expect(g.edgeCount).toBe(2);
    expect(g.neighbors('a', { rel: 'contains' }).map((n) => n.id)).toEqual(['b']);
    expect(g.neighbors('a').map((n) => n.id).sort()).toEqual(['b', 'c']);
    expect(g.neighbors('b', { direction: 'in' }).map((n) => n.id)).toEqual(['a']);
  });

  it('persists to JSONL and reloads from disk', () => {
    const file = tmpFile();
    const a = new KnowledgeGraph({ filePath: file });
    a.upsertNode({ id: 'x', kind: 'file' });
    a.upsertNode({ id: 'y', kind: 'class' });
    a.upsertEdge({ from: 'x', to: 'y', rel: 'contains' });

    const b = new KnowledgeGraph({ filePath: file });
    expect(b.nodeCount).toBe(2);
    expect(b.edgeCount).toBe(1);
    expect(b.neighbors('x', { rel: 'contains' }).map((n) => n.id)).toEqual(['y']);
  });
});

describe('buildGraphFromIndex', () => {
  it('derives file/symbol/module nodes and contains/has-member/imports edges', () => {
    const index = new AstIndex();
    index.indexFile(
      'src/service.ts',
      `import { readFile } from 'node:fs';
       export class Service { run(): void {} }
       export function greet() {}`,
    );

    const g = buildGraphFromIndex(index);

    const fileId = 'file:src/service.ts';
    expect(g.hasNode(fileId)).toBe(true);

    // arquivo contém a classe, a função e (via contains) os símbolos
    const contained = g.neighbors(fileId, { rel: 'contains' }).map((n) => n.id);
    expect(contained).toContain('sym:src/service.ts#Service');
    expect(contained).toContain('sym:src/service.ts#greet');

    // a classe tem o método como membro
    const members = g.neighbors('sym:src/service.ts#Service', { rel: 'has-member' }).map((n) => n.id);
    expect(members).toContain('sym:src/service.ts#Service.run');

    // o arquivo importa o módulo node:fs
    const imports = g.neighbors(fileId, { rel: 'imports' }).map((n) => n.id);
    expect(imports).toContain('module:node:fs');
  });
});
