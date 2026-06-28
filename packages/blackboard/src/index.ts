/**
 * @clover/blackboard — Cognição compartilhada estruturada (RAP §11.7).
 *
 * Workspace compartilhado multi-agente: append-only, versionado por tópico e com
 * autoria registrada (auditável) — evita o caos clássico de blackboard mutável.
 * Usado para colaboração entre atores, para `/status` (saúde) e para a
 * persistência de estado na resiliência catastrófica (recovery do Scheduler).
 *
 * Pure JS; persistência opcional em JSONL (reload na abertura).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Unsubscribe } from '@clover/contracts';

export interface BlackboardEntry {
  id: string;
  topic: string;
  author: string;
  payload: unknown;
  /** Versão incremental por tópico (1-based). */
  version: number;
  taskId?: string;
  ts: number;
}

export type BlackboardInput = {
  topic: string;
  author: string;
  payload: unknown;
  taskId?: string;
};

export interface BlackboardQuery {
  topic?: string;
  author?: string;
  taskId?: string;
}

export interface BlackboardStats {
  entries: number;
  topics: string[];
  authors: string[];
}

export interface BlackboardOptions {
  filePath?: string;
}

export class Blackboard {
  private readonly entries: BlackboardEntry[] = [];
  private readonly topicVersion = new Map<string, number>();
  private readonly subs = new Set<{ q: BlackboardQuery; cb: (e: BlackboardEntry) => void }>();

  constructor(private readonly opts: BlackboardOptions = {}) {
    if (opts.filePath && existsSync(opts.filePath)) {
      for (const line of readFileSync(opts.filePath, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        this.apply(JSON.parse(t) as BlackboardEntry);
      }
    }
  }

  /** Publica uma entrada (append). Atribui id, versão de tópico e timestamp. */
  post(input: BlackboardInput): BlackboardEntry {
    const version = (this.topicVersion.get(input.topic) ?? 0) + 1;
    const entry: BlackboardEntry = {
      id: randomUUID(),
      topic: input.topic,
      author: input.author,
      payload: input.payload,
      taskId: input.taskId,
      version,
      ts: Date.now(),
    };
    this.apply(entry);
    this.persist(entry);
    for (const sub of this.subs) {
      if (matches(sub.q, entry)) sub.cb(entry);
    }
    return entry;
  }

  query(q: BlackboardQuery = {}): BlackboardEntry[] {
    return this.entries.filter((e) => matches(q, e));
  }

  /** Última entrada de um tópico (maior versão). */
  latest(topic: string): BlackboardEntry | undefined {
    const list = this.query({ topic });
    return list.length ? list[list.length - 1] : undefined;
  }

  subscribe(q: BlackboardQuery, cb: (e: BlackboardEntry) => void): Unsubscribe {
    const sub = { q, cb };
    this.subs.add(sub);
    return () => {
      this.subs.delete(sub);
    };
  }

  /** Resumo para `/status`. */
  stats(): BlackboardStats {
    return {
      entries: this.entries.length,
      topics: [...this.topicVersion.keys()].sort(),
      authors: [...new Set(this.entries.map((e) => e.author))].sort(),
    };
  }

  get size(): number {
    return this.entries.length;
  }

  // --- internals ---------------------------------------------------------

  private apply(entry: BlackboardEntry): void {
    this.entries.push(entry);
    const cur = this.topicVersion.get(entry.topic) ?? 0;
    if (entry.version > cur) this.topicVersion.set(entry.topic, entry.version);
  }

  private persist(entry: BlackboardEntry): void {
    if (!this.opts.filePath) return;
    mkdirSync(dirname(this.opts.filePath), { recursive: true });
    appendFileSync(this.opts.filePath, `${JSON.stringify(entry)}\n`);
  }
}

function matches(q: BlackboardQuery, e: BlackboardEntry): boolean {
  if (q.topic !== undefined && e.topic !== q.topic) return false;
  if (q.author !== undefined && e.author !== q.author) return false;
  if (q.taskId !== undefined && e.taskId !== q.taskId) return false;
  return true;
}
