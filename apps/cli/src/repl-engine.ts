/**
 * ReplEngine — núcleo testável do REPL (RAP §13; Escopo 2).
 *
 * Recebe uma linha, decide entre comando de barra (`/...`) e tarefa para o
 * agente, e renderiza via um IO abstrato. Todas as strings vêm do `@clover/i18n`
 * (idioma da config do usuário). Comandos interativos (`/config`, `/provider`,
 * `/exec`) são interceptados pelo glue (`main.ts`) por exigirem raw mode.
 */

import type { AgentRunResult } from '@clover/agent';
import type { Blackboard } from '@clover/blackboard';
import type { AgentMode, ConfigStore } from '@clover/config';
import type { Goal } from '@clover/contracts';
import type { I18n } from '@clover/i18n';
import type { Kernel } from '@clover/kernel';
import { ChoicePrompt, ThemeManager, UsageCounter, parseSlash, processInput, type SlashCommand } from '@clover/tui';
import { session } from '@clover/tools';
import type { ChatHistory } from './chat-history.js';
import type { ToolAgentHistory, ToolCallingAgent } from './tool-agent.js';

export class ModelRegistry {
  private models: string[];
  private activeModel: string;

  constructor(models: string[] = ['qwen2.5-coder'], active?: string) {
    this.models = models.length > 0 ? [...models] : ['qwen2.5-coder'];
    this.activeModel = active && this.models.includes(active) ? active : this.models[0];
  }
  list(): string[] {
    return [...this.models];
  }
  get current(): string {
    return this.activeModel;
  }
  setActive(name: string): boolean {
    if (!this.models.includes(name)) return false;
    this.activeModel = name;
    return true;
  }
  add(name: string): void {
    if (!this.models.includes(name)) this.models.push(name);
  }
}

export interface ReplIO {
  render(text: string): void;
  clear(): void;
}

export interface AgentRunner {
  run(goal: Goal): Promise<AgentRunResult>;
}

export interface ChatProvider {
  complete(req: { system?: string; prompt: string }): Promise<string>;
}

export interface ReplDeps {
  theme: ThemeManager;
  i18n: I18n;
  io: ReplIO;
  agent: AgentRunner;
  kernel: Pick<Kernel, 'listTools'>;
  blackboard: Pick<Blackboard, 'stats' | 'post'>;
  config: Pick<ConfigStore, 'getValue' | 'set'>;
  models: ModelRegistry;
  usage: UsageCounter;
  workspacePath: string;
  chatHistory?: ChatHistory;
  sessionId?: string;
  /** Direct LLM access for conversational responses — bypasses Planner entirely. */
  chatProvider?: ChatProvider;
  /** ReAct tool-calling agent — bypasses Plan IR, uses native function calling. */
  toolAgent?: ToolCallingAgent;
}

export interface HandleResult {
  exit?: boolean;
}

/** Pergunta de autorização customizada e contextual para o Sandbox Tier 3. */
export function buildExecConfirmation(command: string, i18n?: I18n): ChoicePrompt {
  const t = (k: string, fallback: string): string => (i18n ? i18n.t(k) : fallback);
  return new ChoicePrompt(`${t('exec.confirm', 'Autorizar a execução deste comando no Sandbox Tier 3?')}\n  ${command}`, [
    { label: t('exec.once', 'Executar uma vez'), value: 'once', hint: t('exec.onceHint', '') },
    { label: t('exec.always', 'Sempre nesta sessão'), value: 'always', hint: t('exec.alwaysHint', '') },
    { label: t('exec.cancel', 'Cancelar'), value: 'cancel', hint: t('exec.cancelHint', '') },
  ]);
}

let goalSeq = 0;

/** Hot window: kept verbatim, last N turns this session. */
const HOT_TURNS = 10;
/** Warm window: older turns this session, compressed. */
const WARM_TURNS = 20;
/** Cross-session turns loaded from disk on startup. */
const COLD_TURNS = 30;
/** Max chars for hot turn assistant output. */
const HOT_ASSISTANT_CHARS = 600;
/** Max chars for warm/cold turn assistant output (compressed). */
const COLD_ASSISTANT_CHARS = 120;

interface ConversationTurn {
  user: string;
  assistant: string;
}

export class ReplEngine {
  private history: ConversationTurn[] = [];
  private coldHistory: ConversationTurn[] = [];

  constructor(private readonly d: ReplDeps) {
    if (d.chatHistory) {
      // Cross-session cold memory: recent turns from OTHER sessions.
      this.coldHistory = d.chatHistory
        .loadRecent(COLD_TURNS + HOT_TURNS + WARM_TURNS)
        .filter((t) => t.sessionId !== d.sessionId)
        .slice(-COLD_TURNS)
        .map((t) => ({ user: t.user, assistant: t.assistant }));
    }
  }

  /** Pre-load turns (e.g. from --resume) into hot history before the first turn. */
  loadTurns(turns: ConversationTurn[]): void {
    const recent = turns.slice(-(HOT_TURNS + WARM_TURNS));
    this.history = recent.map((t) => ({ user: t.user, assistant: t.assistant }));
  }

  private t(key: string, vars?: Record<string, string | number>): string {
    return this.d.i18n.t(key, vars);
  }

  banner(): string {
    const { theme } = this.d;
    return `${theme.banner(this.t('repl.banner.title'))}\n${theme.dim(this.t('repl.banner.hint'))}`;
  }

  async handleLine(line: string): Promise<HandleResult> {
    const trimmed = line.trim();
    if (!trimmed) return {};
    const slash = parseSlash(trimmed);
    return slash ? this.handleSlash(slash) : this.handleTask(trimmed);
  }

  private handleSlash(cmd: SlashCommand): HandleResult {
    const { theme, io } = this.d;
    switch (cmd.name) {
      case 'help':
        io.render(this.helpText());
        return {};
      case 'clear':
        io.clear();
        return {};
      case 'exit':
      case 'quit':
        io.render(theme.dim(`${this.t('repl.bye')} ${theme.symbols.clover}`));
        return { exit: true };
      case 'model':
        return this.handleModel(cmd.args);
      case 'mode':
        return this.handleMode(cmd.args);
      case 'status':
        io.render(this.statusText());
        return {};
      case 'sessions':
        return this.handleSessions();
      default:
        io.render(theme.warn(this.t('repl.unknown', { name: cmd.name })));
        return {};
    }
  }

  private handleModel(args: string[]): HandleResult {
    const { theme, io, models } = this.d;
    if (args.length === 0) {
      const lines = models
        .list()
        .map((m) =>
          m === models.current
            ? `${theme.accent(theme.symbols.pointer)} ${theme.success(`${m} ${this.t('model.active')}`)}`
            : `  ${m}`,
        );
      io.render([theme.heading(this.t('model.title')), ...lines].join('\n'));
      return {};
    }
    const ok = models.setActive(args[0]);
    io.render(
      ok
        ? theme.success(`${theme.symbols.ok} ${this.t('model.switched', { name: args[0] })}`)
        : theme.error(`${theme.symbols.fail} ${this.t('model.notFound', { name: args[0] })}`),
    );
    return {};
  }

  private handleSessions(): HandleResult {
    const { theme, io } = this.d;
    const sessions = this.d.chatHistory?.listSessions() ?? [];
    if (sessions.length === 0) {
      io.render(theme.dim('Nenhuma sessão salva. Use clover normalmente para começar.'));
      return {};
    }
    const lines = [theme.heading('Sessões anteriores (use clover --resume para retomar a última):')];
    for (const s of sessions.slice(0, 10)) {
      const date = new Date(s.ts).toLocaleString('pt-BR');
      lines.push(`  ${theme.dim(s.sessionId.slice(0, 8))}  ${theme.accent(date)}  ${s.turns} turno(s)  "${s.firstMessage}"`);
    }
    io.render(lines.join('\n'));
    return {};
  }

  private handleMode(args: string[]): HandleResult {
    const { theme, io, config } = this.d;
    const next = args[0];
    if (next !== 'step' && next !== 'auto') {
      io.render(theme.warn(this.t('mode.invalid', { mode: next ?? '' })));
      return {};
    }
    config.set('mode', next as AgentMode);
    io.render(theme.success(`${theme.symbols.ok} ${this.t('mode.switched', { mode: next })}`));
    return {};
  }

  statusText(): string {
    const { theme, kernel, blackboard, models, usage, config } = this.d;
    const bb = blackboard.stats();
    return [
      theme.banner(this.t('status.title')),
      `  ${this.t('status.kernel', { n: theme.success(String(kernel.listTools().length)) })}`,
      `  ${this.t('status.model', { name: theme.success(models.current) })}`,
      `  ${this.t('status.provider', { name: String(config.getValue('activeProvider')) })}`,
      `  ${this.t('status.mode', { mode: theme.accent(String(config.getValue('mode'))) })}`,
      `  ${this.t('status.language', { lang: String(config.getValue('language')) })}`,
      `  ${this.t('status.blackboard', { entries: bb.entries, topics: bb.topics.length })}`,
      `  ${usage.format()}`,
    ].join('\n');
  }

  private async handleTask(text: string): Promise<HandleResult> {
    const { theme, io, agent, workspacePath } = this.d;
    const { text: clean, attachments } = processInput(text);
    if (attachments.length > 0) {
      const tags = attachments
        .map((a) => (a.kind === 'image' ? `[imagem: ${a.path}]` : `[arquivo: ${a.path}]`))
        .join(' ');
      io.render(theme.dim(this.t('task.attachments', { tags })));
    }

    // Tool path: native function calling (ToolCallingAgent) or Plan IR fallback.
    // toolAgent handles both chat and tool queries — model decides which to use.
    if (this.d.toolAgent?.supportsTools) {
      const history: ToolAgentHistory[] = this.history.map((t) => ({ user: t.user, assistant: t.assistant }));
      try {
        const response = await this.d.toolAgent.run(clean, history);
        io.render(`${theme.statusIcon('ok')} ${response}`);
        const turn: ConversationTurn = { user: clean, assistant: response.slice(0, 400) };
        this.history.push(turn);
        if (this.history.length > HOT_TURNS + WARM_TURNS) this.history.shift();
        this.d.chatHistory?.append({ sessionId: this.d.sessionId ?? '', user: clean, assistant: response.slice(0, 400) });
      } catch (err) {
        io.render(theme.error(`${theme.symbols.fail} ${err instanceof Error ? err.message : String(err)}`));
      }
      return {};
    }

    // Fallback: chatProvider for pure text, then Plan IR.
    if (this.d.chatProvider) {
      const prompt = this.buildGoalWithHistory(clean);
      try {
        const response = await this.d.chatProvider.complete({ system: CHAT_SYSTEM, prompt });
        const reply = response.trim() || '(sem resposta)';
        io.render(`${theme.statusIcon('ok')} ${reply}`);
        const turn: ConversationTurn = { user: clean, assistant: reply.slice(0, 400) };
        this.history.push(turn);
        if (this.history.length > HOT_TURNS + WARM_TURNS) this.history.shift();
        this.d.chatHistory?.append({ sessionId: this.d.sessionId ?? '', user: clean, assistant: reply.slice(0, 400) });
      } catch (err) {
        io.render(theme.error(`${theme.symbols.fail} ${err instanceof Error ? err.message : String(err)}`));
      }
      return {};
    }

    // Last resort: Plan IR (legacy path).
    const effectiveWorkspace = session.get() ?? workspacePath;
    const goalText = this.buildGoalWithHistory(clean);
    const goal: Goal = { id: `goal-${++goalSeq}`, text: goalText, workspacePath: effectiveWorkspace };
    try {
      const run = await agent.run(goal);
      if (run.result.status === 'done') {
        const formatted = formatOutputs(run.result.outputs);
        io.render(`${theme.statusIcon('ok')} ${formatted}`);
        const historyEntry = buildHistoryEntry(run.result.outputs);
        const turn: ConversationTurn = { user: clean, assistant: historyEntry };
        this.history.push(turn);
        if (this.history.length > HOT_TURNS + WARM_TURNS) this.history.shift();
        this.d.chatHistory?.append({ sessionId: this.d.sessionId ?? '', user: clean, assistant: historyEntry });
      } else {
        this.notifyFailure(run.result.fault?.message ?? 'unknown', false, run.taskId, goal.text);
      }
    } catch (err) {
      this.notifyFailure(err instanceof Error ? err.message : String(err), true, undefined, goal.text);
    }
    return {};
  }

  private buildGoalWithHistory(currentMessage: string): string {
    const allTurns = [...this.coldHistory, ...this.history];
    if (allTurns.length === 0) return currentMessage;

    const total = allTurns.length;
    // Hot: last HOT_TURNS turns — verbatim assistant output (longer)
    // Warm/cold: older turns — compressed
    const hotStart = Math.max(0, total - HOT_TURNS);

    const lines: string[] = [];
    for (let i = 0; i < total; i++) {
      const t = allTurns[i];
      const isHot = i >= hotStart;
      const limit = isHot ? HOT_ASSISTANT_CHARS : COLD_ASSISTANT_CHARS;
      const assistant = t.assistant.length > limit ? t.assistant.slice(0, limit) + '…' : t.assistant;
      lines.push(`Usuário: ${t.user}\nAssistente: ${assistant}`);
    }

    const sections: string[] = [];
    if (this.coldHistory.length > 0) {
      const cold = lines.slice(0, this.coldHistory.length).join('\n\n');
      sections.push(`[SESSÕES ANTERIORES]\n${cold}`);
    }
    if (this.history.length > 0) {
      const hot = lines.slice(this.coldHistory.length).join('\n\n');
      sections.push(`[CONVERSA ATUAL]\n${hot}`);
    }
    sections.push(`[NOVA MENSAGEM]\n${currentMessage}`);
    return sections.join('\n\n');
  }

  /**
   * Em modo `auto`, uma falha = teto de segurança atingido → suspende a task,
   * salva no Blackboard e notifica. Em `step`, apenas reporta o erro.
   */
  private notifyFailure(reason: string, isError: boolean, taskId: string | undefined, goalText: string): void {
    const { theme, io, config, blackboard } = this.d;
    if (config.getValue('mode') === 'auto') {
      blackboard.post({ topic: 'task:suspended', author: 'cli', payload: { goal: goalText, reason }, taskId });
      io.render(theme.warn(`${theme.symbols.pending} ${this.t('task.suspended', { reason })}`));
    } else if (isError) {
      io.render(theme.error(`${theme.symbols.fail} ${this.t('task.error', { msg: reason })}`));
    } else {
      io.render(theme.error(`${theme.symbols.fail} ${this.t('task.failed', { reason })}`));
    }
  }

  helpText(): string {
    const { theme } = this.d;
    return [
      theme.banner(this.t('help.title')),
      `  ${this.t('help.help')}`,
      `  ${this.t('help.model')}`,
      `  ${this.t('help.status')}`,
      `  ${this.t('help.config')}`,
      `  ${this.t('help.mode')}`,
      `  ${this.t('help.provider')}`,
      `  ${this.t('help.exec')}`,
      `  ${this.t('help.clear')}`,
      `  ${this.t('help.exit')}`,
      theme.dim(`  ${this.t('help.freeText')}`),
      theme.dim(`  ${this.t('help.fileTags')}`),
    ].join('\n');
  }
}

const CHAT_SYSTEM = [
  'Você é o CloverOS, um assistente pessoal inteligente e amigável.',
  'Responda em português de forma concisa, direta e natural.',
  'Quando houver histórico de conversa, use-o para dar contexto às respostas.',
  'Não liste arquivos nem execute ações — apenas responda com texto.',
].join('\n');

/**
 * Returns true if the message explicitly requests a file/tool action.
 * Conservative: only clear action verbs trigger the Planner path.
 */
function needsTools(text: string): boolean {
  return /\b(lista[rl]?|liste|listar|listagem|abri[r]?|abre|l[eê]\b|leia|ler\b|cria[r]?|crie|delet[ae]|apag[ae]|mov[ae]|mover|copi[ae]|copiar|execut[ae]|executar|rod[ae]|rodar|renomei?a[r]?|pesquisar|busca[r]?)\b/i.test(text);
}

/**
 * Builds a compact history annotation from raw plan outputs.
 * Works on structured data before rendering — no emoji/regex hacks.
 * Conversational responses (respond.message) are kept verbatim (≤400 chars).
 * Structured results (file listings, file reads) become compact labels so
 * the LLM knows what happened without being triggered to repeat the action.
 */
function buildHistoryEntry(outputs: unknown[]): string {
  if (!outputs || outputs.length === 0) return '(sem resultado)';
  const first = outputs[0];

  if (Array.isArray(first)) {
    if (first.every(isDirEntry)) return `[listagem: ${first.length} item(s)]`;
    return `[lista: ${first.length} item(s)]`;
  }

  if (typeof first === 'object' && first !== null) {
    const obj = first as Record<string, unknown>;
    if (Array.isArray(obj['entries'])) return `[listagem: ${(obj['entries'] as unknown[]).length} item(s)]`;
    if (typeof obj['content'] === 'string') return `[arquivo lido: ${Math.ceil(obj['content'].length / 1024)} KB]`;
    if (typeof obj['message'] === 'string') return obj['message'].slice(0, 400);
    if (typeof obj['output'] === 'object' && obj['output'] !== null) return buildHistoryEntry([obj['output']]);
  }

  if (typeof first === 'string') return first.slice(0, 400);

  return '(resultado)';
}

function formatOutputs(outputs: unknown[]): string {
  if (!outputs || outputs.length === 0) return '(...)';
  return outputs.map(formatSingleOutput).filter(Boolean).join('\n') || '(...)';
}

function formatDirEntries(entries: Array<{ name?: string; type?: string; size?: number }>): string {
  if (entries.length === 0) return '(diretório vazio)';
  return entries
    .map((e) => {
      const icon = e.type === 'dir' ? '📁' : '📄';
      const size = e.type === 'file' && (e.size ?? 0) > 0 ? ` (${Math.round((e.size ?? 0) / 1024)} KB)` : '';
      return `${icon} ${e.name ?? '?'}${size}`;
    })
    .join('\n');
}

function isDirEntry(x: unknown): x is { name?: string; type?: string; size?: number } {
  return typeof x === 'object' && x !== null && ('name' in x || 'type' in x);
}

const TEMPLATE_GARBAGE = /\{\{.*?\}\}/s;
const OBJECT_GARBAGE = /^\[object Object\]/;

function formatSingleOutput(o: unknown): string {
  if (o === null || o === undefined) return '';
  if (typeof o === 'string') {
    if (TEMPLATE_GARBAGE.test(o)) return '';
    // respond tool received non-string (array) and String() was called → try JSON parse
    if (OBJECT_GARBAGE.test(o)) return '(dados não formatados — tente reformular a pergunta)';
    // Might be JSON-stringified entries array from respond fix
    if (o.startsWith('[') || o.startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(o);
        return formatSingleOutput(parsed);
      } catch {
        // not JSON, return as-is
      }
    }
    return o;
  }
  if (typeof o !== 'object') return String(o);

  // Raw array — may be entries returned directly via path:'entries'
  if (Array.isArray(o)) {
    if (o.length === 0) return '(diretório vazio)';
    if (o.every(isDirEntry)) return formatDirEntries(o as Array<{ name?: string; type?: string; size?: number }>);
    return o.map((item) => formatSingleOutput(item)).join('\n');
  }

  const obj = o as Record<string, unknown>;

  // respond / message output
  if (typeof obj['message'] === 'string') return obj['message'];

  // list_files / list_directory output object
  if (Array.isArray(obj['entries'])) {
    return formatDirEntries(obj['entries'] as Array<{ name?: string; type?: string; size?: number }>);
  }

  // read_file output
  if (typeof obj['content'] === 'string') return obj['content'];

  // generic success output
  if (typeof obj['output'] === 'string') return obj['output'];
  if (obj['output'] !== null && obj['output'] !== undefined) return formatSingleOutput(obj['output']);

  return JSON.stringify(o, null, 2);
}
