/**
 * @clover/planner — Planner do CloverOS (RAP §11.2; ADR-004).
 *
 * Transforma uma meta + tools disponíveis em um Plan IR validado, gerado por um
 * LlmProvider sob constrained decoding (schema). Implementa o laço
 * **gerar → parsear → validar → reparar** que é a defesa real contra saídas
 * malformadas de modelos pequenos. O Planner NUNCA retorna um plano inválido.
 */

import type {
  Goal,
  IREdge,
  IRNode,
  IRRef,
  PlanIR,
  ToolDescriptor,
} from '@clover/contracts';
import { validatePlan } from '@clover/ir';
import type { LlmProvider } from '@clover/llm';

import { buildPlanSchema } from './schema.js';
import { PLANNER_SYSTEM, buildPlannerPrompt, buildRepairPrompt } from './prompt.js';

export { buildPlanSchema } from './schema.js';
export { PLANNER_SYSTEM, buildPlannerPrompt, buildRepairPrompt } from './prompt.js';

/** Erro lançado quando o Planner não consegue produzir um plano válido. */
export class PlanningError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
    readonly attempts: number,
  ) {
    super(message);
    this.name = 'PlanningError';
  }
}

export interface PlannerOptions {
  /** Tentativas totais (1 geração + N reparos). Default 2. */
  maxAttempts?: number;
}

export interface PlanOptions {
  /** Contexto estrutural recuperado (AST/KG), já limitado pelo orçamento. */
  contextText?: string;
  /** Contexto do sistema operacional (caminhos reais: home, Desktop, etc.). */
  osContext?: string;
}

export class Planner {
  private readonly maxAttempts: number;

  constructor(
    private readonly provider: LlmProvider,
    opts: PlannerOptions = {},
  ) {
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  }

  /** Gera um Plan IR válido para a meta, ou lança PlanningError. */
  async plan(goal: Goal, tools: ToolDescriptor[], opts: PlanOptions = {}): Promise<PlanIR> {
    const schema = buildPlanSchema(tools);
    const toolNames = new Set(tools.map((t) => t.name));
    const contextText = opts.contextText;
    let lastErrors: string[] = [];

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const prompt =
        attempt === 1
          ? buildPlannerPrompt(goal.text, tools, contextText, opts.osContext)
          : buildRepairPrompt(goal.text, tools, lastErrors, contextText, opts.osContext);

      const raw = await this.provider.completeStructured({
        system: PLANNER_SYSTEM,
        prompt,
        schema,
      });

      const parsed = tryParseJson(raw);
      if (!parsed.ok) {
        lastErrors = [parsed.error];
        continue;
      }

      const candidate = autoRepairPlan(normalizePlan(parsed.value, goal));
      const errors = validateCandidate(candidate, toolNames);
      if (errors.length === 0) return candidate;
      lastErrors = errors;
    }

    throw new PlanningError(
      `Planner falhou após ${this.maxAttempts} tentativa(s)`,
      lastErrors,
      this.maxAttempts,
    );
  }
}

// ===========================================================================
// Helpers (puros, testáveis)
// ===========================================================================

type ParseResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

/** Parse defensivo: remove cercas markdown eventuais antes do JSON.parse. */
export function tryParseJson(raw: string): ParseResult {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    const value = JSON.parse(cleaned);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'JSON deve ser um objeto de plano' };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: `JSON inválido: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Repara o plano antes da validação: corrige outputs que referenciam nós
 * inexistentes (limitação do constrained decoding — o modelo não sabe quais IDs
 * vai gerar quando preenche outputs). Aponta para o último nó da lista como
 * heurística — no DAG linear gerado por modelos pequenos, o último nó é o
 * resultado final.
 */
export function autoRepairPlan(plan: PlanIR): PlanIR {
  const ids = new Set(plan.nodes.map((n) => n.id));
  if (ids.size === 0) return plan;
  const lastId = plan.nodes[plan.nodes.length - 1].id;

  const repairedOutputs = plan.outputs.length > 0
    ? plan.outputs.map((out) => ids.has(out.nodeId) ? out : { ...out, nodeId: lastId })
    : [{ kind: 'ref' as const, nodeId: lastId, path: '' }];

  return { ...plan, outputs: repairedOutputs };
}

/** Coage o objeto bruto em um PlanIR (campos faltantes viram defaults). */
export function normalizePlan(obj: Record<string, unknown>, goal: Goal): PlanIR {
  return {
    version: '1',
    goalId: goal.id, // autoritativo: o Planner fixa o goalId.
    nodes: Array.isArray(obj.nodes) ? (obj.nodes as IRNode[]) : [],
    edges: Array.isArray(obj.edges) ? (obj.edges as IREdge[]) : [],
    outputs: Array.isArray(obj.outputs) ? (obj.outputs as IRRef[]) : [],
  };
}

/**
 * Validação combinada: estrutural (via @clover/ir) + semântica (toda tool_call
 * referencia uma tool existente). Retorna lista de erros (vazia = válido).
 */
export function validateCandidate(plan: PlanIR, toolNames: Set<string>): string[] {
  const errors: string[] = [];

  const structural = validatePlan(plan);
  if (!structural.ok) errors.push(...structural.errors);

  if (plan.nodes.length === 0) errors.push('plano sem nós');

  for (const node of plan.nodes) {
    if (node.kind === 'tool_call') {
      if (!toolNames.has(node.tool)) {
        errors.push(`nó ${node.id}: tool desconhecida '${node.tool}'`);
      }
    }
  }
  return errors;
}
