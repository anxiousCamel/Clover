/**
 * @clover/resource-manager — Governança de recursos (RAP §11.6).
 *
 * Primitivas puras (sem dep nativa) para limitar concorrência, impor timeouts e
 * contabilizar orçamento. Limites finos de CPU/RAM/GPU dependem do backend de
 * sandbox (cgroups/WASM fuel) e entram com ele; aqui ficam os controles que o
 * runtime Node oferece de forma confiável.
 */

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
