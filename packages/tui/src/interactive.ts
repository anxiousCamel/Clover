/**
 * UI interativa controlada por teclas (raw mode) — modelos puros e testáveis.
 *
 * O CLI lê bytes crus do stdin (raw mode, sem echo), decodifica via `decodeKey`,
 * atualiza o estado (`ChoicePrompt`/`StatusBoard`) e **re-renderiza**. Assim, a
 * tecla digitada nunca "vaza" feio na tela — a interface só reage e renderiza o
 * resultado de forma limpa.
 */

import type { ThemeManager } from './theme.js';

// --- Decodificação de teclas ------------------------------------------------

const ESC = '\x1b';
const CTRL_C = '\x03';

export type Key = 'up' | 'down' | 'enter' | 'cancel' | { digit: number } | 'other';

export function decodeKey(seq: string): Key {
  if (seq === CTRL_C || seq === ESC) return 'cancel';
  if (seq === '\r' || seq === '\n') return 'enter';
  if (seq === `${ESC}[A` || seq === `${ESC}OA` || seq === 'k') return 'up';
  if (seq === `${ESC}[B` || seq === `${ESC}OB` || seq === 'j') return 'down';
  if (/^[1-9]$/.test(seq)) return { digit: Number(seq) };
  return 'other';
}

// --- Prompt de escolha (human-in-the-loop) ----------------------------------

export interface Choice {
  label: string;
  value: string;
  /** Descrição contextual opcional (pergunta customizada). */
  hint?: string;
}

export interface ChoiceResult {
  done: boolean;
  value?: string;
  cancelled?: boolean;
}

export class ChoicePrompt {
  private selected = 0;

  constructor(
    readonly question: string,
    readonly choices: Choice[],
  ) {
    if (choices.length === 0) throw new Error('ChoicePrompt requer ao menos uma escolha');
  }

  get index(): number {
    return this.selected;
  }

  /** Processa uma tecla; retorna o estado da seleção. */
  handle(key: Key): ChoiceResult {
    const n = this.choices.length;
    if (key === 'up') {
      this.selected = (this.selected - 1 + n) % n;
    } else if (key === 'down') {
      this.selected = (this.selected + 1) % n;
    } else if (key === 'enter') {
      return { done: true, value: this.choices[this.selected].value };
    } else if (key === 'cancel') {
      return { done: true, cancelled: true };
    } else if (typeof key === 'object' && 'digit' in key) {
      if (key.digit >= 1 && key.digit <= n) {
        this.selected = key.digit - 1;
        return { done: true, value: this.choices[this.selected].value };
      }
    }
    return { done: false };
  }

  /** Renderiza a UI limpa de escolha (setas + numeração). */
  render(theme: ThemeManager): string {
    const lines = [theme.heading(`${theme.symbols.clover} ${this.question}`)];
    this.choices.forEach((c, i) => {
      const active = i === this.selected;
      const prefix = active ? theme.accent(theme.symbols.pointer) : ' ';
      const label = `${i + 1}. ${c.label}`;
      const text = active ? theme.success(label) : label;
      const hint = c.hint ? theme.dim(`  ${c.hint}`) : '';
      lines.push(`${prefix} ${text}${hint}`);
    });
    lines.push(theme.dim('  setas navegam / numero seleciona / Enter confirma / Esc cancela'));
    return lines.join('\n');
  }
}

// --- Painel de status multi-tarefa (Actor Model) ----------------------------

export type TaskState = 'pending' | 'running' | 'done' | 'failed';

export interface StatusTask {
  id: string;
  label: string;
  state: TaskState;
}

export class StatusBoard {
  private readonly tasks = new Map<string, StatusTask>();
  private frame = 0;

  add(id: string, label: string, state: TaskState = 'running'): void {
    this.tasks.set(id, { id, label, state });
  }
  update(id: string, patch: Partial<Omit<StatusTask, 'id'>>): void {
    const t = this.tasks.get(id);
    if (t) this.tasks.set(id, { ...t, ...patch });
  }
  remove(id: string): void {
    this.tasks.delete(id);
  }
  tick(): void {
    this.frame++;
  }
  clear(): void {
    this.tasks.clear();
  }

  get activeCount(): number {
    return [...this.tasks.values()].filter((t) => t.state === 'running').length;
  }
  get size(): number {
    return this.tasks.size;
  }

  /** Linhas dinâmicas para tarefas concorrentes (uma por ator/tarefa). */
  render(theme: ThemeManager): string {
    const frames = theme.symbols.spinner;
    const spin = frames[this.frame % frames.length];
    return [...this.tasks.values()]
      .map((t) => {
        if (t.state === 'running') return `${theme.accent(spin)} ${t.label}`;
        const icon =
          t.state === 'done'
            ? theme.statusIcon('ok')
            : t.state === 'failed'
              ? theme.statusIcon('fail')
              : theme.statusIcon('pending');
        const label = t.state === 'failed' ? theme.error(t.label) : t.label;
        return `${icon} ${label}`;
      })
      .join('\n');
  }
}

// --- Rótulos de raciocínio vivo --------------------------------------------

/** Mapeia tópicos do Event Bus para frases de "raciocínio vivo". */
export function phaseLabel(topic: string): string {
  switch (topic) {
    case 'task:submitted':
      return 'Recebendo tarefa...';
    case 'context:build':
      return 'Montando contexto (orcamento de tokens)...';
    case 'plan:start':
      return 'Gerando Plan IR (constrained decoding)...';
    case 'plan:validate':
      return 'Validando gramatica/IR...';
    case 'node:start':
      return 'Executando passo do plano...';
    case 'plan:done':
      return 'Concluido';
    case 'plan:failed':
      return 'Falhou';
    default:
      return topic;
  }
}
