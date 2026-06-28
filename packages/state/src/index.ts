/**
 * @clover/state — Event Store + Snapshots + Projeções (ADR-005, RAP §5.3, §15).
 *
 * O **journal append-only é a fonte da verdade**. As projeções (status de task,
 * etc.) são reconstruíveis por replay e, portanto, descartáveis. Esta fatia usa
 * persistência em JSONL puro-JS (sem dependência nativa); a troca por SQLite
 * nativo como read-model é uma otimização posterior, sem mudar o contrato.
 *
 * Itens fora desta fatia: re-execução por checkpoint (resume que pula nós já
 * concluídos) exige cooperação do Executor — ver PROGRESS.md.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { EventEnvelope, ExecEvent, PlanIR, Unsubscribe } from '@clover/contracts';
import type { EventBus } from '@clover/event-bus';

// ===========================================================================
// Event Store (append-only journal)
// ===========================================================================

export interface EventStoreOptions {
  /** Se definido, persiste cada evento como uma linha JSON (JSONL) e recarrega. */
  filePath?: string;
}

export class EventStore {
  private readonly events: EventEnvelope[] = [];

  constructor(private readonly opts: EventStoreOptions = {}) {
    if (opts.filePath && existsSync(opts.filePath)) {
      const text = readFileSync(opts.filePath, 'utf8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) this.events.push(JSON.parse(trimmed) as EventEnvelope);
      }
    }
  }

  /** Anexa um evento (e persiste, se houver filePath). Retorna o offset gravado. */
  append(evt: EventEnvelope): number {
    const offset = this.events.length;
    this.events.push(evt);
    if (this.opts.filePath) {
      mkdirSync(dirname(this.opts.filePath), { recursive: true });
      appendFileSync(this.opts.filePath, `${JSON.stringify(evt)}\n`);
    }
    return offset;
  }

  /** Lê o journal a partir de um offset (default 0). */
  read(fromOffset = 0): EventEnvelope[] {
    return this.events.slice(fromOffset);
  }

  get length(): number {
    return this.events.length;
  }
}

/**
 * Liga o Event Bus ao journal: toda emissão vira durabilidade + auditoria
 * (RAP §18). Observabilidade e persistência pelo mesmo caminho.
 */
export function recordBusToStore(bus: EventBus, store: EventStore, pattern = '*'): Unsubscribe {
  return bus.subscribe(pattern, (evt: EventEnvelope) => {
    store.append(evt);
  });
}

// ===========================================================================
// Snapshots (checkpoints)
// ===========================================================================

export interface Snapshot<T = unknown> {
  taskId: string;
  state: T;
  /** Offset do journal coberto por este snapshot (para resume). */
  offset: number;
  ts: number;
}

export class SnapshotStore {
  private readonly snaps = new Map<string, Snapshot>();

  constructor(private readonly dir?: string) {}

  save<T>(snap: Snapshot<T>): void {
    this.snaps.set(snap.taskId, snap);
    if (this.dir) {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(`${this.dir}/${snap.taskId}.json`, JSON.stringify(snap));
    }
  }

  load<T>(taskId: string): Snapshot<T> | undefined {
    const inMem = this.snaps.get(taskId) as Snapshot<T> | undefined;
    if (inMem) return inMem;
    if (this.dir) {
      const path = `${this.dir}/${taskId}.json`;
      if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as Snapshot<T>;
    }
    return undefined;
  }
}

// ===========================================================================
// Projeções (read-model reconstruível por replay)
// ===========================================================================

export type ProjectedStatus = 'running' | 'done' | 'failed';

export interface TaskProjection {
  taskId: string;
  goalId?: string;
  status: ProjectedStatus;
  completedNodes: string[];
  outputs?: unknown[];
}

/**
 * Reconstrói o estado das tasks PURAMENTE a partir do journal — a essência do
 * event sourcing: nenhum estado vivo é necessário para a recuperação.
 */
/**
 * Reconstrói as saídas dos nós já concluídos de uma task a partir do journal
 * (eventos `node:done`). Base do resume incremental: o que já rodou não roda de
 * novo. O evento mais recente para um nó vence.
 */
export function rebuildNodeOutputs(
  events: EventEnvelope[],
  taskId: string,
): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  for (const evt of events) {
    if (evt.topic === 'node:done') {
      const p = evt.payload as Extract<ExecEvent, { type: 'node:done' }>;
      if (p.taskId === taskId) outputs[p.nodeId] = p.output;
    }
  }
  return outputs;
}

/**
 * Recupera o Plan IR de uma task a partir do journal (evento `task:submitted`
 * com o plano no payload). Permite resume sem nenhum estado vivo.
 */
export function findSubmittedPlan(
  events: EventEnvelope[],
  taskId: string,
): PlanIR | undefined {
  for (const evt of events) {
    if (evt.topic === 'task:submitted') {
      const p = evt.payload as { taskId: string; plan?: PlanIR };
      if (p.taskId === taskId && p.plan) return p.plan;
    }
  }
  return undefined;
}

export function projectTasks(events: EventEnvelope[]): Map<string, TaskProjection> {
  const tasks = new Map<string, TaskProjection>();

  const ensure = (taskId: string): TaskProjection => {
    let t = tasks.get(taskId);
    if (!t) {
      t = { taskId, status: 'running', completedNodes: [] };
      tasks.set(taskId, t);
    }
    return t;
  };

  for (const evt of events) {
    switch (evt.topic) {
      case 'task:submitted': {
        const p = evt.payload as { taskId: string; goalId?: string };
        const t = ensure(p.taskId);
        t.goalId = p.goalId;
        break;
      }
      case 'node:done': {
        const p = evt.payload as Extract<ExecEvent, { type: 'node:done' }>;
        ensure(p.taskId).completedNodes.push(p.nodeId);
        break;
      }
      case 'plan:done': {
        const p = evt.payload as Extract<ExecEvent, { type: 'plan:done' }>;
        const t = ensure(p.taskId);
        t.status = 'done';
        t.outputs = p.outputs;
        break;
      }
      case 'plan:failed': {
        const p = evt.payload as Extract<ExecEvent, { type: 'plan:failed' }>;
        ensure(p.taskId).status = 'failed';
        break;
      }
      default:
        break;
    }
  }
  return tasks;
}
