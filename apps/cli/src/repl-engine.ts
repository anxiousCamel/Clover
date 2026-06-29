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

export class ReplEngine {
  constructor(private readonly d: ReplDeps) {}

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
    const goal: Goal = { id: `goal-${++goalSeq}`, text: clean, workspacePath };
    try {
      const run = await agent.run(goal);
      if (run.result.status === 'done') {
        io.render(`${theme.statusIcon('ok')} ${formatOutputs(run.result.outputs)}`);
      } else {
        this.notifyFailure(run.result.fault?.message ?? 'unknown', false, run.taskId, goal.text);
      }
    } catch (err) {
      this.notifyFailure(err instanceof Error ? err.message : String(err), true, undefined, goal.text);
    }
    return {};
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

function formatOutputs(outputs: unknown[]): string {
  if (!outputs || outputs.length === 0) return '(...)';
  return outputs.map((o) => (typeof o === 'string' ? o : JSON.stringify(o))).join('\n');
}
