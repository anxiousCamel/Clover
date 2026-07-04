/**
 * @clover/resource-manager — Governança de recursos (RAP §11.6).
 *
 * Primitivas puras (sem dep nativa) para limitar concorrência, impor timeouts e
 * contabilizar orçamento. Limites finos de CPU/RAM/GPU dependem do backend de
 * sandbox (cgroups/WASM fuel) e entram com ele; aqui ficam os controles que o
 * runtime Node oferece de forma confiável.
 */

import type { ToolIntent } from '@clover/contracts';

export class TimeoutError extends Error {
  constructor(ms: number, label: string) {
    super(`${label} excedeu o timeout de ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/** Rejeita se `p` não resolver dentro de `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms, label)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Semáforo assíncrono justo (FIFO). O slot é transferido diretamente ao próximo
 * em espera no `release`, evitando sobre-subscrição.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error('Semaphore: max deve ser >= 1');
  }

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next(); // transfere o slot (active inalterado)
    } else if (this.active > 0) {
      this.active--;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get inFlight(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiters.length;
  }
}

/** Orçamento consumível (ex.: tokens, escritas de arquivo, comandos). */
export class Budget {
  private used = 0;
  constructor(private readonly limit: number) {}

  /** Consome `n` se couber; retorna false (sem consumir) se estourar. */
  tryConsume(n = 1): boolean {
    if (this.used + n > this.limit) return false;
    this.used += n;
    return true;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  get consumed(): number {
    return this.used;
  }
}

export interface ResourceLimits {
  /** Máximo de tarefas executando ao mesmo tempo. Default: ilimitado. */
  maxConcurrent?: number;
  /** Timeout default por execução (ms). */
  defaultTimeoutMs?: number;
}

/**
 * Fachada de governança: limita concorrência e aplica timeouts. O Scheduler usa
 * `run()` para envelopar a execução de cada task.
 */
export class ResourceManager {
  private readonly sem: Semaphore;
  private readonly defaultTimeoutMs?: number;

  constructor(limits: ResourceLimits = {}) {
    this.sem = new Semaphore(limits.maxConcurrent ?? Number.MAX_SAFE_INTEGER);
    this.defaultTimeoutMs = limits.defaultTimeoutMs;
  }

  /** Executa `fn` respeitando o limite de concorrência (e timeout, se houver). */
  run<T>(fn: () => Promise<T>, timeoutMs = this.defaultTimeoutMs): Promise<T> {
    return this.sem.run(() => (timeoutMs ? withTimeout(fn(), timeoutMs, 'task') : fn()));
  }

  get inFlight(): number {
    return this.sem.inFlight;
  }

  get queued(): number {
    return this.sem.queued;
  }
}

// ===========================================================================
// Execution Governor — trava de autorização + auditoria (RAP §11.6, segurança)
// ===========================================================================

/** Contexto de uma decisão de autorização de tool. */
export interface AuthContext {
  tool: string;
  intent: ToolIntent;
  taskId: string;
  traceId: string;
  args: Record<string, unknown>;
}

/** Decisão de autorização. */
export interface AuthDecision {
  allowed: boolean;
  reason?: string;
}

/** Prompt de aprovação interativo (modo step). Retorna true = autorizado. */
export type ApprovalPrompt = (ctx: AuthContext) => Promise<boolean> | boolean;

/** Entrada do log de auditoria (toda decisão sobre write/destructive). */
export interface AuditEntry {
  ts: number;
  tool: string;
  intent: ToolIntent;
  taskId: string;
  traceId: string;
  mode: GovernorMode;
  decision: 'allowed' | 'denied';
  reason?: string;
}

/** Sink de auditoria (ex.: Event Bus, Blackboard, arquivo). */
export type AuditSink = (entry: AuditEntry) => void;

export type GovernorMode = 'step' | 'auto';

export interface ExecutionGovernorOptions {
  /** `step` = pede aprovação; `auto` = registra e permite. Default: `step`. */
  mode?: GovernorMode;
  /** Prompt de aprovação (obrigatório em `step` para autorizar writes). */
  prompt?: ApprovalPrompt;
  /** Sink de auditoria. Default: no-op. */
  audit?: AuditSink;
  /**
   * Timeout por execução de tool (ms). Aplicado via `withTimeout` — NÃO reentra
   * no semáforo do RM (a concorrência já é governada no nível da task, no Agent;
   * reentrar aqui causaria deadlock por aquisição aninhada no mesmo pool).
   */
  perToolTimeoutMs?: number;
  /** Relógio (testes). */
  now?: () => number;
}

/**
 * Governor: a **trava** que o Kernel injeta no Executor. Duas responsabilidades:
 *
 *  1. `authorize(ctx)` — tools `read` passam direto; `write`/`destructive` exigem
 *     autorização. Em `step`, pede aprovação (nega se não houver `prompt`, ou se
 *     o usuário reprovar — **fail-safe**). Em `auto`, registra na auditoria e
 *     permite. TODA decisão sobre write/destructive é auditada.
 *  2. `guard(fn)` — envelopa a execução da tool com **timeout** do RM (a
 *     concorrência já é governada no nível da task, no Agent — não reentrar no
 *     semáforo aqui, sob risco de deadlock).
 *
 * `intent` é sinal de aprovação/auditoria, NÃO de contenção — a contenção
 * continua sendo o capability-token + fronteira de workspace.
 */
export class ExecutionGovernor {
  private readonly mode: GovernorMode;
  private readonly prompt?: ApprovalPrompt;
  private readonly audit: AuditSink;
  private readonly perToolTimeoutMs?: number;
  private readonly now: () => number;

  constructor(opts: ExecutionGovernorOptions = {}) {
    this.mode = opts.mode ?? 'step';
    this.prompt = opts.prompt;
    this.audit = opts.audit ?? (() => {});
    this.perToolTimeoutMs = opts.perToolTimeoutMs;
    this.now = opts.now ?? Date.now;
  }

  async authorize(ctx: AuthContext): Promise<AuthDecision> {
    if (ctx.intent === 'read') return { allowed: true };

    let decision: AuthDecision;
    if (this.mode === 'auto') {
      decision = { allowed: true };
    } else if (!this.prompt) {
      // Fail-safe: modo step sem aprovador não pode autorizar mutação.
      decision = { allowed: false, reason: 'sem aprovador configurado (modo step)' };
    } else {
      const ok = await this.prompt(ctx);
      decision = ok ? { allowed: true } : { allowed: false, reason: 'reprovado pelo usuário' };
    }

    this.audit({
      ts: this.now(),
      tool: ctx.tool,
      intent: ctx.intent,
      taskId: ctx.taskId,
      traceId: ctx.traceId,
      mode: this.mode,
      decision: decision.allowed ? 'allowed' : 'denied',
      reason: decision.reason,
    });
    return decision;
  }

  /** Envelopa a execução da tool com timeout (sem reentrar no semáforo). */
  guard<T>(fn: () => Promise<T>): Promise<T> {
    if (this.perToolTimeoutMs) return withTimeout(fn(), this.perToolTimeoutMs, 'tool');
    return fn();
  }
}
