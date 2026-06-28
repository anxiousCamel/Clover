/**
 * @clover/agent-runtime — Modelo de atores (RAP §4, §11; "workers pequenos").
 *
 * Cada ator processa mensagens **uma de cada vez** (mailbox sequencial), com
 * **estado isolado** — sem estado mutável compartilhado entre atores. É o
 * substrato para "centenas de agentes": concorrência entre atores, serialização
 * dentro de cada um. Atores se comunicam por mensagens via `ctx.send`.
 *
 * Implementação mínima sobre microtasks do Node — sem dependências.
 */

export interface ActorContext {
  /** Nome deste ator. */
  readonly self: string;
  /** Envia uma mensagem a outro ator (fire-and-forget). */
  send(to: string, msg: unknown): void;
}

/** Comportamento: recebe estado + mensagem, retorna o novo estado. */
export type Behavior<M, S> = (state: S, msg: M, ctx: ActorContext) => S | Promise<S>;

interface Envelope<M> {
  msg: M;
  resolve: () => void;
  reject: (err: unknown) => void;
}

class Actor<M, S> {
  private readonly queue: Envelope<M>[] = [];
  private processing = false;
  private state: S;

  constructor(
    readonly name: string,
    initial: S,
    private readonly behavior: Behavior<M, S>,
    private readonly ctx: ActorContext,
  ) {
    this.state = initial;
  }

  /** Enfileira uma mensagem; resolve quando ELA tiver sido processada. */
  enqueue(msg: M): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ msg, resolve, reject });
      this.schedule();
    });
  }

  getState(): S {
    return this.state;
  }

  get backlog(): number {
    return this.queue.length;
  }

  private schedule(): void {
    if (this.processing) return;
    this.processing = true;
    queueMicrotask(() => void this.drain());
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const env = this.queue.shift()!;
      try {
        this.state = await this.behavior(this.state, env.msg, this.ctx);
        env.resolve();
      } catch (err) {
        env.reject(err);
      }
    }
    this.processing = false;
  }
}

export class UnknownActorError extends Error {
  constructor(name: string) {
    super(`ator desconhecido: ${name}`);
    this.name = 'UnknownActorError';
  }
}

export class ActorSystem {
  private readonly actors = new Map<string, Actor<any, any>>();

  /** Cria um ator com estado inicial e comportamento. Retorna seu nome (ref). */
  spawn<M, S>(name: string, initial: S, behavior: Behavior<M, S>): string {
    if (this.actors.has(name)) throw new Error(`ator já existe: ${name}`);
    const ctx: ActorContext = {
      self: name,
      send: (to, msg) => {
        void this.send(to, msg);
      },
    };
    this.actors.set(name, new Actor<M, S>(name, initial, behavior, ctx));
    return name;
  }

  /** Envia uma mensagem; o retorno resolve quando ela for processada. */
  send(name: string, msg: unknown): Promise<void> {
    const actor = this.actors.get(name);
    if (!actor) return Promise.reject(new UnknownActorError(name));
    return actor.enqueue(msg);
  }

  has(name: string): boolean {
    return this.actors.has(name);
  }

  getState<S = unknown>(name: string): S | undefined {
    return this.actors.get(name)?.getState() as S | undefined;
  }

  backlog(name: string): number {
    return this.actors.get(name)?.backlog ?? 0;
  }

  stop(name: string): void {
    this.actors.delete(name);
  }

  get size(): number {
    return this.actors.size;
  }
}
