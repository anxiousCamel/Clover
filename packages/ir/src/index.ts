/**
 * @clover/ir — Schema, Validator e análise do Plan IR (RAP §6).
 *
 * O Validator é a garantia central de confiabilidade: nenhum plano inválido
 * chega ao Execution Engine. Como a IR é dado (não código), tudo aqui é
 * testável por property-based/fuzzing.
 */

import {
  isIRRef,
  type IRNode,
  type IRRef,
  type IRValue,
  type PlanIR,
} from '@clover/contracts';

export interface ValidationOk {
  ok: true;
}
export interface ValidationErr {
  ok: false;
  errors: string[];
}
export type ValidationResult = ValidationOk | ValidationErr;

/** Args de qualquer nó (tool_call e transform expõem `args`). */
function nodeArgs(node: IRNode): Record<string, IRValue> {
  return node.args;
}

/** Coleta recursivamente todas as IRRef contidas em um IRValue. */
export function collectRefs(value: IRValue): IRRef[] {
  if (isIRRef(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(collectRefs);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(collectRefs);
  }
  return [];
}

/** Conjunto de nodeIds dos quais `node` depende (via refs nos args). */
export function dependenciesOf(node: IRNode): Set<string> {
  const deps = new Set<string>();
  for (const v of Object.values(nodeArgs(node))) {
    for (const ref of collectRefs(v)) deps.add(ref.nodeId);
  }
  return deps;
}

/**
 * Valida um Plan IR:
 *  - versão suportada;
 *  - ids de nó únicos;
 *  - toda IRRef aponta para um nó existente;
 *  - outputs referenciam nós existentes;
 *  - o grafo (refs + edges explícitas) é acíclico (DAG).
 */
export function validatePlan(plan: PlanIR): ValidationResult {
  const errors: string[] = [];

  if (plan.version !== '1') {
    errors.push(`versão de IR não suportada: ${String(plan.version)}`);
  }

  const ids = new Set<string>();
  for (const node of plan.nodes) {
    if (ids.has(node.id)) errors.push(`id de nó duplicado: ${node.id}`);
    ids.add(node.id);
  }

  // Refs nos args apontam para nós existentes.
  for (const node of plan.nodes) {
    for (const v of Object.values(nodeArgs(node))) {
      for (const ref of collectRefs(v)) {
        if (!ids.has(ref.nodeId)) {
          errors.push(`nó ${node.id}: ref para nó inexistente '${ref.nodeId}'`);
        }
      }
    }
  }

  // Edges explícitas apontam para nós existentes.
  for (const e of plan.edges) {
    if (!ids.has(e.from)) errors.push(`edge inválida: 'from' inexistente '${e.from}'`);
    if (!ids.has(e.to)) errors.push(`edge inválida: 'to' inexistente '${e.to}'`);
  }

  // Outputs referenciam nós existentes.
  for (const out of plan.outputs) {
    if (!ids.has(out.nodeId)) {
      errors.push(`output referencia nó inexistente '${out.nodeId}'`);
    }
  }

  // Aciclicidade (só vale a pena checar se refs/ids estão coerentes).
  if (errors.length === 0) {
    const cycle = findCycle(plan);
    if (cycle) errors.push(`ciclo detectado: ${cycle.join(' -> ')}`);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** Lista de adjacência: from -> [to...] a partir de refs e edges explícitas. */
function buildAdjacency(plan: PlanIR): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const node of plan.nodes) adj.set(node.id, new Set());

  // Dependência via ref: dep precede node (dep -> node).
  for (const node of plan.nodes) {
    for (const dep of dependenciesOf(node)) {
      if (adj.has(dep)) adj.get(dep)!.add(node.id);
    }
  }
  // Edges explícitas.
  for (const e of plan.edges) {
    if (adj.has(e.from)) adj.get(e.from)!.add(e.to);
  }
  return adj;
}

/** Retorna um ciclo (lista de nós) se existir, senão null. */
export function findCycle(plan: PlanIR): string[] | null {
  const adj = buildAdjacency(plan);
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adj.keys()) color.set(id, WHITE);
  const stack: string[] = [];

  const dfs = (u: string): string[] | null => {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === GRAY) {
        const i = stack.indexOf(v);
        return stack.slice(i).concat(v);
      }
      if (color.get(v) === WHITE) {
        const found = dfs(v);
        if (found) return found;
      }
    }
    color.set(u, BLACK);
    stack.pop();
    return null;
  };

  for (const id of adj.keys()) {
    if (color.get(id) === WHITE) {
      const found = dfs(id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Ordenação topológica (Kahn). Lança se houver ciclo — chame `validatePlan`
 * antes para um erro estruturado.
 */
export function topoSort(plan: PlanIR): string[] {
  const adj = buildAdjacency(plan);
  const indeg = new Map<string, number>();
  for (const id of adj.keys()) indeg.set(id, 0);
  for (const tos of adj.values()) for (const to of tos) indeg.set(to, (indeg.get(to) ?? 0) + 1);

  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const u = queue.shift()!;
    order.push(u);
    for (const v of adj.get(u) ?? []) {
      indeg.set(v, indeg.get(v)! - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }
  if (order.length !== plan.nodes.length) {
    throw new Error('topoSort: grafo possui ciclo');
  }
  return order;
}

/**
 * Níveis de execução: cada nível é um conjunto de nós independentes que podem
 * rodar em paralelo. Saída útil para o Optimizer/Executor (RAP §6: paralelizar
 * nós independentes do DAG).
 */
export function executionLevels(plan: PlanIR): string[][] {
  const adj = buildAdjacency(plan);
  const indeg = new Map<string, number>();
  for (const id of adj.keys()) indeg.set(id, 0);
  for (const tos of adj.values()) for (const to of tos) indeg.set(to, (indeg.get(to) ?? 0) + 1);

  const levels: string[][] = [];
  let frontier = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let seen = 0;
  while (frontier.length) {
    levels.push(frontier);
    const next: string[] = [];
    for (const u of frontier) {
      seen++;
      for (const v of adj.get(u) ?? []) {
        indeg.set(v, indeg.get(v)! - 1);
        if (indeg.get(v) === 0) next.push(v);
      }
    }
    frontier = next;
  }
  if (seen !== plan.nodes.length) {
    throw new Error('executionLevels: grafo possui ciclo');
  }
  return levels;
}

/**
 * Optimizer — na Fatia 1 é identidade (preserva semântica). As otimizações
 * descritas no RAP (CSE, dead-node elimination) exigem conhecer pureza das
 * tools (vêm da Tool ABI) e entram na próxima fatia. `executionLevels` já
 * fornece a base para paralelização.
 */
export function optimize(plan: PlanIR): PlanIR {
  return plan;
}
