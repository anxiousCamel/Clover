/**
 * @clover/event-bus — Backbone de comunicação do CloverOS (RAP §11.10).
 *
 * Pub/sub síncrono e in-memory sobre EventEmitter (mesmo padrão do telemetry
 * bus atual do backend), promovido a cidadão de primeira classe. Suporta
 * tópicos hierárquicos com wildcard por sufixo `*` (ex.: 'node:*', '*').
 *
 * O bus completa `id` e `ts` ausentes na publicação. A entrega é síncrona para
 * não adicionar latência ao caminho quente; observadores (logs/tracing/replay)
 * assinam aqui.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import type {
  EventEnvelope,
  EventHandler,
  PublishableEvent,
  Unsubscribe,
} from '@clover/contracts';

/** Padrão de tópico: exato ('node:done'), prefixo ('node:*') ou tudo ('*'). */
export type TopicPattern = string;

interface Subscription {
  pattern: TopicPattern;
  handler: EventHandler;
}

export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly subs = new Set<Subscription>();

  constructor() {
    // Evita o aviso de leak quando muitos subsistemas assinam.
    this.emitter.setMaxListeners(0);
  }

  /** Publica um evento; completa id/ts ausentes e entrega aos assinantes. */
  publish<T>(evt: PublishableEvent<T>): EventEnvelope<T> {
    const full: EventEnvelope<T> = {
      ...evt,
      id: evt.id ?? randomUUID(),
      ts: evt.ts ?? Date.now(),
    };
    for (const sub of this.subs) {
      if (matches(sub.pattern, full.topic)) {
        (sub.handler as EventHandler<T>)(full);
      }
    }
    // Canal cru para quem quiser usar o EventEmitter diretamente.
    this.emitter.emit('event', full);
    return full;
  }

  /** Assina um padrão de tópico. Retorna função de cancelamento. */
  subscribe<T>(pattern: TopicPattern, handler: EventHandler<T>): Unsubscribe {
    const sub: Subscription = { pattern, handler: handler as EventHandler };
    this.subs.add(sub);
    return () => {
      this.subs.delete(sub);
    };
  }

  /** Número de assinaturas ativas (útil para testes). */
  get subscriptionCount(): number {
    return this.subs.size;
  }
}

/** Casamento de padrão: '*' = tudo; 'pref:*' = prefixo; senão igualdade exata. */
export function matches(pattern: TopicPattern, topic: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith(':*')) {
    return topic.startsWith(pattern.slice(0, -1)); // mantém o ':' do prefixo
  }
  return pattern === topic;
}
