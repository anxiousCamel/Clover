/**
 * @clover/scheduler — Scheduler durável (RAP §11.1, §15).
 *
 * Substitui o fire-and-forget: toda task é **persistida no journal** (incluindo
 * o próprio Plan IR) e é **resumível**. Um orquestrador novo, com apenas o
 * journal em disco, consegue retomar uma task re-executando SOMENTE os nós
 * restantes (resume incremental por checkpoint) — viabilizando tarefas de
 * horas/dias e recovery após crash.
 *
 * Esta fatia entrega submit/resume sequenciais. Fila com prioridade/fairness e
 * limites de concorrência (Resource Manager) entram na fatia de segurança.
 */

import { randomUUID } from 'node:crypto';

import type { PlanIR, RunResult } from '@clover/contracts';
import type { Kernel } from '@clover/kernel';
import {
  EventStore,
  findSubmittedPlan,
  rebuildNodeOutputs,
  recordBusToStore,
} from '@clover/state';

export interface SubmitOptions {
  workspacePath?: string;
}

export interface TaskHandle {
  taskId: string;
  result: RunResult;
}

export class DurableScheduler {
  private wired = false;

  constructor(
    private readonly kernel: Kernel,
    private readonly store: EventStore,
  ) {}

  /** Liga o Event Bus do kernel ao journal uma única vez. */
  private ensureWired(): void {
    if (this.wired) return;
    recordBusToStore(this.kernel.events, this.store);
    this.wired = true;
  }

  /**
   * Submete um plano: persiste `task:submitted` (com o Plan IR) e executa.
   * O plano no journal é o que torna a task recuperável sem estado vivo.
   */
  async submit(plan: PlanIR, opts: SubmitOptions = {}): Promise<TaskHandle> {
    this.ensureWired();
    const taskId = randomUUID();

    this.kernel.events.publish({
      topic: 'task:submitted',
      traceId: taskId,
      source: 'scheduler',
      payload: { taskId, goalId: plan.goalId, plan },
    });

    const result = await this.kernel.executePlan(plan, taskId, {
      workspacePath: opts.workspacePath,
    });
    return { taskId, result };
  }

  /**
   * Retoma uma task a partir do journal: recupera o plano e as saídas dos nós
   * já concluídos, e re-executa apenas os nós restantes (resume incremental).
   */
  async resume(taskId: string): Promise<RunResult> {
    this.ensureWired();
    const events = this.store.read();

    const plan = findSubmittedPlan(events, taskId);
    if (!plan) {
      throw new Error(
        `DurableScheduler.resume: plano não encontrado no journal para a task '${taskId}'`,
      );
    }

    const nodeOutputs = rebuildNodeOutputs(events, taskId);
    return this.kernel.executePlan(plan, taskId, { resume: { nodeOutputs } });
  }
}
