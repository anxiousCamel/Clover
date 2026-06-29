/**
 * @clover/knowledge-graph — Grafo de conhecimento embarcado (RAP §9; Fase 4).
 *
 * Relações estruturais do código (arquivo contém símbolo, classe tem membro,
 * arquivo importa módulo) como um grafo consultável. **Derivado do AST Index** —
 * a fonte da verdade é o repositório, não o grafo. Backing puro-JS (mapas de
 * adjacência + persistência JSONL); um backend embarcado mais forte (kuzu /
 * SQLite recursive CTEs) pode entrar atrás da mesma API.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { AstIndex } from '@clover/ast-index';

export interface KGNode {
  id: string;
  kind: string;
  props?: Record<string, unknown>;
}

export interface KGEdge {
  from: string;
  to: string;
  rel: string;
  props?: Record<string, unknown>;
}

export type Direction = 'out' | 'in' | 'both';

export interface NeighborQuery {
  rel?: string;
  direction?: Direction;
}

export interface KnowledgeGraphOptions {
  /** Persiste nós/arestas como JSONL e recarrega na abertura. */
  filePath?: string;
}

export class KnowledgeGraph {
  private readonly nodes = new Map<string, KGNode>();
  private readonly outEdges = new Map<string, KGEdge[]>();
  private readonly inEdges = new Map<string, KGEdge[]>();
  private edgeTotal = 0;

  constructor(private readonly opts: KnowledgeGraphOptions = {}) {
    if (opts.filePath && existsSync(opts.filePath)) {
      for (const line of readFileSync(opts.filePath, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const rec = JSON.parse(t) as { t: 'node' | 'edge'; node?: KGNode; edge?: KGEdge };
        if (rec.t === 'node' && rec.node) this.applyNode(rec.node);
        else if (rec.t === 'edge' && rec.edge) this.applyEdge(rec.edge);
      }
    }
  }

  upsertNode(node: KGNode): void {
    this.applyNode(node);
    this.persist({ t: 'node', node });
  }

  upsertEdge(edge: KGEdge): void {
    this.applyEdge(edge);
    this.persist({ t: 'edge', edge });
  }

  getNode(id: string): KGNode | undefined {
    return this.nodes.get(id);
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  /** Nós vizinhos (a outra ponta das arestas), filtrando por relação/direção. */
  neighbors(id: string, query: NeighborQuery = {}): KGNode[] {
    const dir = query.direction ?? 'out';
    const edges: Array<{ edge: KGEdge; other: string }> = [];
    if (dir === 'out' || dir === 'both') {
      for (const e of this.outEdges.get(id) ?? []) edges.push({ edge: e, other: e.to });
    }
    if (dir === 'in' || dir === 'both') {
      for (const e of this.inEdges.get(id) ?? []) edges.push({ edge: e, other: e.from });
    }
    const seen = new Set<string>();
    const result: KGNode[] = [];
    for (const { edge, other } of edges) {
      if (query.rel && edge.rel !== query.rel) continue;
      if (seen.has(other)) continue;
      seen.add(other);
      const n = this.nodes.get(other);
      if (n) result.push(n);
    }
    return result;
  }

  /** Arestas incidentes em `id` (out/in/both), opcionalmente por relação. */
  edgesOf(id: string, query: NeighborQuery = {}): KGEdge[] {
    const dir = query.direction ?? 'out';
    const edges: KGEdge[] = [];
    if (dir === 'out' || dir === 'both') edges.push(...(this.outEdges.get(id) ?? []));
    if (dir === 'in' || dir === 'both') edges.push(...(this.inEdges.get(id) ?? []));
    return query.rel ? edges.filter((e) => e.rel === query.rel) : edges;
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edgeTotal;
  }

  // --- internals ---------------------------------------------------------

  private applyNode(node: KGNode): void {
    this.nodes.set(node.id, node);
  }

  private applyEdge(edge: KGEdge): void {
    if (!this.outEdges.has(edge.from)) this.outEdges.set(edge.from, []);
    if (!this.inEdges.has(edge.to)) this.inEdges.set(edge.to, []);
    this.outEdges.get(edge.from)!.push(edge);
    this.inEdges.get(edge.to)!.push(edge);
    this.edgeTotal++;
  }

  private persist(rec: { t: 'node' | 'edge'; node?: KGNode; edge?: KGEdge }): void {
    if (!this.opts.filePath) return;
    mkdirSync(dirname(this.opts.filePath), { recursive: true });
    appendFileSync(this.opts.filePath, `${JSON.stringify(rec)}\n`);
  }
}

/**
 * Constrói o grafo a partir do AST Index (RAP §9: KG derivado do AST).
 * Nós: arquivo, símbolos, módulos. Arestas: contains, has-member, imports.
 */
export function buildGraphFromIndex(
  index: AstIndex,
  graph: KnowledgeGraph = new KnowledgeGraph(),
): KnowledgeGraph {
  for (const file of index.allFiles()) {
    const fileId = `file:${file.filePath}`;
    graph.upsertNode({ id: fileId, kind: 'file', props: { path: file.filePath } });

    for (const sym of file.symbols) {
      const prefix = sym.container ? `${sym.container}.` : '';
      const symId = `sym:${file.filePath}#${prefix}${sym.name}`;
      graph.upsertNode({
        id: symId,
        kind: sym.kind,
        props: { name: sym.name, exported: sym.exported, line: sym.line },
      });
      graph.upsertEdge({ from: fileId, to: symId, rel: 'contains' });
      if (sym.container) {
        const containerId = `sym:${file.filePath}#${sym.container}`;
        graph.upsertEdge({ from: containerId, to: symId, rel: 'has-member' });
      }
    }

    for (const imp of file.imports) {
      const modId = `module:${imp.from}`;
      graph.upsertNode({ id: modId, kind: 'module', props: { specifier: imp.from } });
      graph.upsertEdge({ from: fileId, to: modId, rel: 'imports', props: { names: imp.names } });
    }
  }
  return graph;
}
