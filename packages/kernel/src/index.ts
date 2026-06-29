/**
 * @clover/kernel — O microkernel do CloverOS (RAP §4, §11).
 *
 * Fatia 1 (walking skeleton): o kernel é a TCB que costura Event Bus + Tool
 * Registry/Bridge + Capability Resolver + Execution Engine, e expõe a operação
 * central: `submitPlan(plan)` → executa o Plan IR e retorna o resultado.
 *
 * Subsistemas plenos (Scheduler durável, State/event-store, Planner, Sandbox,
 * Resource Manager) entram nas próximas fatias como plugins, sem alterar este
 * núcleo — é exatamente o ponto do microkernel.
 */

import { randomUUID } from 'node:crypto';

import type { PlanIR, RunResult, ToolDescriptor } from '@clover/contracts';
import { EventBus } from '@clover/event-bus';
import { CapabilityResolver } from '@clover/capability';
import { ExecutionEngine, type ResumeState } from '@clover/executor';
import { LocalToolBridge, ToolRegistry, type LocalTool, type ToolBridge } from '@clover/tool-abi';

export interface SubmitPlanOptions {
  workspacePath?: string;
  /** Reaproveitar um traceId (ex.: vindo do Scheduler). */
  traceId?: string;
}

export interface ExecutePlanOptions {
  workspacePath?: string;
  traceId?: string;
  /** Estado de retomada (resume incremental por checkpoint). */
  resume?: ResumeState;
}

export class Kernel {
  readonly events: EventBus;
  private readonly registry: ToolRegistry;
  private readonly bridge: ToolBridge;
  private readonly capabilities: CapabilityResolver;
  private readonly engine: ExecutionEngine;
  private booted = false;

  constructor() {
    this.events = new EventBus();
    this.registry = new ToolRegistry();
    this.bridge = new LocalToolBridge(this.registry);
    this.capabilities = new CapabilityResolver();
    this.engine = new ExecutionEngine(this.bridge, this.events, {
      verifyToken: (t) => this.capabilities.verify(t),
    });
  }

  /** Registra uma tool local. (No futuro: também MCP/WASM via outras bridges.) */
  registerTool(tool: LocalTool): this {
    this.registry.register(tool);
    return this;
  }

  registerTools(tools: LocalTool[]): this {
    for (const t of tools) this.registry.register(t);
    return this;
  }

  /** Catálogo de descritores das tools registradas (para Tool Search / Context). */
  listTools(): ToolDescriptor[] {
    return this.registry.list();
  }

  /** Inicializa o kernel e anuncia no Event Bus. Idempotente. */
  boot(): this {
    if (this.booted) return this;
    this.booted = true;
    this.events.publish({
      topic: 'kernel:booted',
      traceId: 'kernel',
      source: 'kernel',
      payload: { tools: this.registry.list().map((t) => t.name) },
    });
    return this;
  }

  /**
   * Executa um Plan IR para um `taskId` JÁ DEFINIDO. Cunha o token de menor
   * privilégio e roda a Execution Engine (com `resume` opcional). NÃO emite
   * `task:submitted` — a identidade/persistência da task é responsabilidade de
   * quem chama (ex.: o Scheduler durável).
   */
  async executePlan(
    plan: PlanIR,
    taskId: string,
    opts: ExecutePlanOptions = {},
  ): Promise<RunResult> {
    if (!this.booted) this.boot();
    const traceId = opts.traceId ?? taskId;
    const workspacePath = opts.workspacePath ?? process.cwd();
    const token = this.capabilities.mint(plan, taskId, { tools: this.registry.list() });
    return this.engine.run(plan, token, { taskId, traceId, workspacePath }, opts.resume);
  }

  /**
   * Submete um Plan IR: gera o `taskId`, emite `task:submitted` e executa.
   * Conveniência para uso direto; o Scheduler durável usa `executePlan`.
   */
  async submitPlan(plan: PlanIR, opts: SubmitPlanOptions = {}): Promise<RunResult> {
    if (!this.booted) this.boot();
    const taskId = randomUUID();
    const traceId = opts.traceId ?? taskId;
    this.events.publish({
      topic: 'task:submitted',
      traceId,
      source: 'kernel',
      payload: { taskId, goalId: plan.goalId },
    });
    return this.executePlan(plan, taskId, { traceId, workspacePath: opts.workspacePath });
  }
}

/** Factory: kernel com tools pré-registradas. */
export function createKernel(tools: LocalTool[] = []): Kernel {
  return new Kernel().registerTools(tools).boot();
}

export { CapabilityResolver } from '@clover/capability';
export { demoTools, echoTool, concatTool } from './tools.js';
