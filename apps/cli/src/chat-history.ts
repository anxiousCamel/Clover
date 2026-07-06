/**
 * ChatHistory — persiste turnos da conversa em JSONL para memória cross-session.
 *
 * Cada linha: { ts, sessionId, user, assistant }
 * `loadSession(id)` restaura todos os turnos de uma sessão específica.
 * `lastSessionId()` retorna o sessionId mais recente no arquivo.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ChatTurn {
  ts: number;
  sessionId: string;
  user: string;
  assistant: string;
}

export class ChatHistory {
  constructor(private readonly filePath: string) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  append(turn: Omit<ChatTurn, 'ts'>): void {
    const entry: ChatTurn = { ts: Date.now(), ...turn };
    try {
      appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
    } catch {
      // non-fatal — write failure must not crash the REPL
    }
  }

  private readAll(): ChatTurn[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return readFileSync(this.filePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => { try { return JSON.parse(l) as ChatTurn; } catch { return null; } })
        .filter((t): t is ChatTurn => t !== null);
    } catch {
      return [];
    }
  }

  /** Returns the sessionId of the most recent session (last line in file). */
  lastSessionId(): string | null {
    const all = this.readAll();
    return all.length > 0 ? all[all.length - 1].sessionId : null;
  }

  /** Load all turns for a specific session, in order. */
  loadSession(sessionId: string): ChatTurn[] {
    return this.readAll().filter((t) => t.sessionId === sessionId);
  }

  /** Load last `n` turns across all sessions. */
  loadRecent(n: number): ChatTurn[] {
    const all = this.readAll();
    return all.slice(-n);
  }

  /** List distinct sessions: id + first message + turn count + timestamp. */
  listSessions(): Array<{ sessionId: string; firstMessage: string; turns: number; ts: number }> {
    const map = new Map<string, { firstMessage: string; turns: number; ts: number }>();
    for (const t of this.readAll()) {
      if (!map.has(t.sessionId)) {
        map.set(t.sessionId, { firstMessage: t.user.slice(0, 80), turns: 0, ts: t.ts });
      }
      map.get(t.sessionId)!.turns++;
    }
    return [...map.entries()]
      .map(([sessionId, m]) => ({ sessionId, ...m }))
      .sort((a, b) => b.ts - a.ts);
  }
}
