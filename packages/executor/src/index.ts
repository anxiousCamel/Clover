/**
 * @clover/executor — IR VM / DAG Runner (RAP §11.3, Tier 0 do §5.2).
 *
 * Valida → ordena → executa um Plan IR. Nós independentes do mesmo nível rodam
 * em paralelo. Cada nó passa pelo gate de capability e tem seus bindings (IRRef)
 * resolvidos a partir das saídas anteriores. Eventos são publicados no Event
 * Bus para observabilidade/replay; um `checkpoint` é emitido após cada nível
 * (persistência do checkpoint entra na Fatia 2 — ver PROGRESS.md).
 *
 * Esta é a execução do Tier 0: orquestração declarativa, SEM eval de código.
 */

import type {
  CapabilityToken,
  ExecEvent,
  ExecutionFault,
  IRNode,
  IRValue,
  PlanIR,
  RunResult,
  ToolInvocation,
} from '@clover/contracts';
import { isIRRef } from '@clover/contracts';
import { EventBus } from '@clover/event-bus';
import { executionLevels, validatePlan } from '@clover/ir';
import type { ToolBridge } from '@clover/tool-abi';

export interface ExecContext {
  taskId: string;
  traceId: string;
  workspacePath: string;
}

/** Erro interno de resolução de ref (capturado e convertido em fault). */
class RefError extends Error {
  constructor(public readonly nodeId: string, message: string) {
    super(message);
  }
}

/** Falha de execução com checagem inicial (capability/validation). */
class NodeFault extends Error {
  constructor(public readonly fault: ExecutionFault) {
    super(fault.message);
  }
}

export class ExecutionEngine {
  constructor(
    private readonly bridge: ToolBridge,
    private readonly bus: EventBus,
  ) {}

  /** Executa um plano e retorna o resultado final. Fail-fast no skeleton. */
  async run(plan: PlanIR, token: CapabilityToken, ctx: ExecContext): Promise<RunResult> {
    const nodeOutputs: Record<string, unknown> = {};

    // 1) Validação — nenhum plano inválido executa.
    const v = validatePlan(plan);
    if (!v.ok) {
      const fault: ExecutionFault = { code: 'validation', message: v.errors.join('; ') };
      this.emit({ type: 'plan:failed', taskId: ctx.taskId, fault }, ctx);
      return { taskId: ctx.taskId, status: 'failed', outputs: [], nodeOutputs, fault };
    }

    const nodeById = new Map(plan.nodes.map((n) => [n.id, n]));
    this.emit(
      { type: 'plan:start', taskId: ctx.taskId, nodeCount: plan.nodes.length },
      ctx,
    );

    // 2) Execução por níveis (nós independentes em paralelo).
    const levels = executionLevels(plan);
    const completed: string[] = [];

    for (const level of levels) {
      try {
        await Promise.all(
          level.map(async (nodeId) => {
            const node = nodeById.get(nodeId)!;
            const output = await this.executeNode(node, nodeOutputs, token, ctx);
            nodeOutputs[nodeId] = output;
          }),
        );
      } catch (err) {
        const fault = toFault(err);
        this.emit(
          { type: 'node:fault', taskId: ctx.taskId, nodeId: fault.nodeId ?? '?', fault },
          ctx,
        );
        this.emit({ type: 'plan:failed', taskId: ctx.taskId, fault }, ctx);
        return { taskId: ctx.taskId, status: 'failed', outputs: [], nodeOutputs, fault };
      }

      completed.push(...level);
      // Checkpoint após cada nível (durabilidade real entra na Fatia 2).
      this.emit({ type: 'checkpoint', taskId: ctx.taskId, completed: [...completed] }, ctx);
    }

    // 3) Resolve as saídas do plano.
    let outputs: unknown[];
    try {
      outputs = plan.outputs.map((ref) => resolveValue(ref, nodeOutputs));
    } catch (err) {
      const fault = toFault(err);
      this.emit({ type: 'plan:failed', taskId: ctx.taskId, fault }, ctx);
      return { taskId: ctx.taskId, status: 'failed', outputs: [], nodeOutputs, fault };
    }

    this.emit({ type: 'plan:done', taskId: ctx.taskId, outputs }, ctx);
    return { taskId: ctx.taskId, status: 'done', outputs, nodeOutputs };
  }

  // -----------------------------------------------------------------------

  private async executeNode(
    node: IRNode,
    outputs: Record<string, unknown>,
    token: CapabilityToken,
    ctx: ExecContext,
  ): Promise<unknown> {
    this.emit(
      {
        type: 'node:start',
        taskId: ctx.taskId,
        nodeId: node.id,
        tool: node.kind === 'tool_call' ? node.tool : undefined,
      },
      ctx,
    );

    // Resolve bindings (IRRef -> valores reais).
    const args = resolveArgs(node.args, outputs);

    let output: unknown;
    if (node.kind === 'tool_call') {
      output = await this.executeToolCall(node.id, node.tool, args, token, ctx);
    } else {
      output = executeTransform(node.op, args);
    }

    this.emit({ type: 'node:done', taskId: ctx.taskId, nodeId: node.id, output }, ctx);
    return output;
  }

  private async executeToolCall(
    nodeId: string,
    tool: string,
    args: Record<string, unknown>,
    token: CapabilityToken,
    ctx: ExecContext,
  ): Promise<unknown> {
    // Gate de capability: a task só pode chamar tools concedidas (menor privilégio).
    const allowed = token.caps.some((c) => c.kind === 'tool' && c.name === tool);
    if (!allowed) {
      throw new NodeFault({
        code: 'capability_denied',
        nodeId,
        message: `capability negada: tool '${tool}' não autorizada para a task`,
      });
    }
    if (!this.bridge.has(tool)) {
      throw new NodeFault({ code: 'tool_not_found', nodeId, message: `tool não encontrada: ${tool}` });
    }

    const invocation: ToolInvocation = {
      taskId: ctx.taskId,
      traceId: ctx.traceId,
      workspacePath: ctx.workspacePath,
      token,
      emit: (topic, payload) =>
        this.bus.publish({ topic, traceId: ctx.traceId, spanId: nodeId, source: tool, payload }),
    };

    const result = await this.bridge.invoke(tool, args, invocation);
    if (!result.success) {
      throw new NodeFault({
        code: 'tool_error',
        nodeId,
        message: result.error ?? `tool '${tool}' falhou`,
      });
    }
    return result.output;
  }

  private emit(evt: ExecEvent, ctx: ExecContext): void {
    const spanId = 'nodeId' in evt ? (evt as { nodeId?: string }).nodeId : undefined;
    this.bus.publish({
      topic: evt.type,
      traceId: ctx.traceId,
      spanId,
      source: 'executor',
      payload: evt,
    });
  }
}

// ===========================================================================
// Resolução de bindings (IRRef) e transforms declarativos
// ===========================================================================

function resolveArgs(
  args: Record<string, IRValue>,
  outputs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) out[k] = resolveValue(v, outputs);
  return out;
}

/** Substitui recursivamente IRRefs por valores reais das saídas dos nós. */
export function resolveValue(value: IRValue, outputs: Record<string, unknown>): unknown {
  if (isIRRef(value)) {
    if (!(value.nodeId in outputs)) {
      throw new RefError(value.nodeId, `ref não resolvida: '${value.nodeId}' ainda não executou`);
    }
    const base = outputs[value.nodeId];
    return value.path ? getPath(base, value.path, value.nodeId) : base;
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, outputs));
  if (value !== null && typeof value === 'object') {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) obj[k] = resolveValue(v as IRValue, outputs);
    return obj;
  }
  return value;
}

/** Indexa um caminho por pontos (ex.: 'files.0.name'). */
function getPath(base: unknown, path: string, nodeId: string): unknown {
  let cur: unknown = base;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) {
      throw new RefError(nodeId, `path '${path}' inválido: segmento '${seg}' sobre valor nulo`);
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Transforms declarativos puros (sem eval). Reservado/expandido na Fatia 2. */
function executeTransform(op: string, args: Record<string, unknown>): unknown {
  switch (op) {
    case 'concat': {
      const parts = (args.parts as unknown[]) ?? [];
      return { text: parts.map((p) => String(p)).join(String(args.sep ?? '')) };
    }
    case 'pick':
      return (args.from as Record<string, unknown>)?.[String(args.key)];
    case 'template': {
      const tpl = String(args.template ?? '');
      const vars = (args.vars as Record<string, unknown>) ?? {};
      return { text: tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) };
    }
    default:
      throw new NodeFault({ code: 'tool_error', message: `transform desconhecido: ${op}` });
  }
}

function toFault(err: unknown): ExecutionFault {
  if (err instanceof NodeFault) return err.fault;
  if (err instanceof RefError) {
    return { code: 'ref_unresolved', nodeId: err.nodeId, message: err.message };
  }
  return { code: 'tool_error', message: err instanceof Error ? err.message : String(err) };
}
