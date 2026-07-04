/**
 * intelligence/graph — Grafo de imports do workspace (SRP: só teoria de grafos +
 * resolução de specifier; sem I/O, sem Zod). Alimentado pelo Workspace Index.
 *
 * ESCOPO (honesto): resolve apenas specifiers **relativos** (`./x`, `../y`) para
 * arquivos indexados — a resolução de pacotes (`@clover/foo`, `node:fs`) é
 * classificada como dependência **externa** (não vira aresta do grafo interno).
 * Ciclos entre pacotes do monorepo via specifier de pacote não são detectados
 * (exigiria mapear package.json → src de cada pacote; fatia futura).
 */

import { posix } from 'node:path';

import type { IndexedImport } from '../index/store.js';

/** Sufixos tentados na resolução (ordem importa: fonte antes de JS emitido). */
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

/**
 * Resolve um specifier relativo a partir de `fromPath` (path indexado, com `/`)
 * contra o conjunto de arquivos indexados. Cobre a convenção ESM do repo
 * (`./x.js` no fonte → `x.ts` no disco). Retorna o path indexado ou `null`.
 */
export function resolveRelativeImport(
  fromPath: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('.')) return null; // pacote/builtin → externo
  const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  // `./x.js` no fonte ESM aponta para `x.ts`/`x.tsx` no disco.
  const stripped = base.replace(/\.(js|jsx)$/, '');
  const candidates =
    stripped === base
      ? RESOLVE_SUFFIXES.map((s) => base + s)
      : [base, `${stripped}.ts`, `${stripped}.tsx`, ...RESOLVE_SUFFIXES.map((s) => stripped + s)];
  for (const c of candidates) {
    if (files.has(c)) return c;
  }
  return null;
}

export interface ImportEdge {
  from: string;
  to: string;
  /** Specifier original como escrito. */
  specifier: string;
  line: number;
}

export interface ExternalDep {
  from: string;
  module: string;
  line: number;
}

export interface ImportGraph {
  /** Arestas internas resolvidas (arquivo → arquivo). */
  edges: ImportEdge[];
  /** Imports de pacotes/builtins (não resolvidos para arquivos do workspace). */
  externals: ExternalDep[];
  /** Adjacência: from → to[] (ordenada, sem duplicatas). */
  adjacency: Map<string, string[]>;
}

/** Constrói o grafo a partir dos imports do índice + lista de arquivos indexados. */
export function buildImportGraph(files: string[], imports: IndexedImport[]): ImportGraph {
  const fileSet = new Set(files);
  const edges: ImportEdge[] = [];
  const externals: ExternalDep[] = [];
  const adjacency = new Map<string, string[]>();

  for (const imp of imports) {
    const target = resolveRelativeImport(imp.path, imp.module, fileSet);
    if (target) {
      edges.push({ from: imp.path, to: target, specifier: imp.module, line: imp.line });
    } else if (!imp.module.startsWith('.')) {
      externals.push({ from: imp.path, module: imp.module, line: imp.line });
    }
    // Relativo não resolvido (arquivo fora do índice): ignorado do grafo.
  }

  for (const e of edges) {
    const list = adjacency.get(e.from) ?? [];
    if (!list.includes(e.to)) list.push(e.to);
    adjacency.set(e.from, list);
  }
  for (const list of adjacency.values()) list.sort();

  return { edges, externals, adjacency };
}

/**
 * Detecta ciclos no grafo por DFS iterativa com pilha de caminho. Cada ciclo é
 * canonicalizado (rotacionado para começar no menor nó) e deduplicado — saída
 * determinística e estável.
 */
export function findCycles(graph: ImportGraph, maxCycles = 50): string[][] {
  const seen = new Set<string>();
  const cycles: string[][] = [];
  const nodes = [...graph.adjacency.keys()].sort();

  const canonical = (cycle: string[]): string => {
    let minIdx = 0;
    for (let i = 1; i < cycle.length; i++) if (cycle[i]! < cycle[minIdx]!) minIdx = i;
    return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)].join(' -> ');
  };

  const dfs = (start: string): void => {
    const path: string[] = [];
    const onPath = new Set<string>();
    const visited = new Set<string>();

    const walk = (node: string): void => {
      if (cycles.length >= maxCycles) return;
      path.push(node);
      onPath.add(node);
      visited.add(node);
      for (const next of graph.adjacency.get(node) ?? []) {
        if (onPath.has(next)) {
          const cycle = path.slice(path.indexOf(next));
          const key = canonical(cycle);
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(key.split(' -> '));
          }
        } else if (!visited.has(next)) {
          walk(next);
        }
      }
      path.pop();
      onPath.delete(node);
    };

    walk(start);
  };

  for (const n of nodes) {
    if (cycles.length >= maxCycles) break;
    dfs(n);
  }
  return cycles;
}

/** Dependências diretas de um arquivo: internas resolvidas + externas. */
export function dependenciesOf(
  graph: ImportGraph,
  path: string,
): { internal: string[]; external: string[] } {
  const internal = [...new Set(graph.edges.filter((e) => e.from === path).map((e) => e.to))].sort();
  const external = [
    ...new Set(graph.externals.filter((e) => e.from === path).map((e) => e.module)),
  ].sort();
  return { internal, external };
}

/** Dependentes reversos: quem importa `path` (via aresta interna resolvida). */
export function reverseDependenciesOf(graph: ImportGraph, path: string): string[] {
  return [...new Set(graph.edges.filter((e) => e.to === path).map((e) => e.from))].sort();
}
