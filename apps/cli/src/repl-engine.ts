/**
 * ReplEngine — núcleo testável do REPL (RAP §13; Escopo 2).
 *
 * Recebe uma linha, decide entre comando de barra (`/...`) e tarefa para o
 * agente, e renderiza via um IO abstrato. O acoplamento ao terminal real (raw
 * mode, spinners, readline) vive no glue (`terminal.ts`/`main.ts`).
 */

import type { AgentRunResult } from '@clover/agent';
import type { Blackboard } from '@clover/blackboard';
import type { Goal } from '@clover/contracts';
import type { Kernel } from '@clover/kernel';
import {
  ChoicePrompt,
  ThemeManager,
  UsageCounter,
  parseSlash,
  processInput,
  type SlashCommand,
} from '@clover/tui';

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
  io: ReplIO;
  agent: AgentRunner;
  kernel: Pick<Kernel, 'listTools'>;
  blackboard: Pick<Blackboard, 'stats'>;
  models: ModelRegistry;
  usage: UsageCounter;
  workspacePath: string;
}

export interface HandleResult {
  exit?: boolean;
}

/** Pergunta de autorização customizada e contextual para o Sandbox Tier 3. */
export function buildExecConfirmation(command: string): ChoicePrompt {
  return new ChoicePrompt(
    `Autorizar a execução deste comando no Sandbox Tier 3?\n  ${command}`,
    [
      { label: 'Executar uma vez', value: 'once', hint: 'roda agora, isolado e com timeout' },
      { label: 'Sempre nesta sessão', value: 'always', hint: 'não perguntar de novo' },
      { label: 'Cancelar', value: 'cancel', hint: 'não executar' },
    ],
  );
}

let goalSeq = 0;

export class ReplEngine {
  constructor(private readonly d: ReplDeps) {}

  banner(): string {
    const { theme } = this.d;
    return `${theme.banner('CloverOS REPL')}\n${theme.dim('Digite uma tarefa, ou /help para os comandos.')}`;
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
        io.render(theme.dim(`Até logo ${theme.symbols.clover}`));
        return { exit: true };
      case 'model':
        return this.handleModel(cmd.args);
      case 'status':
        io.render(this.statusText());
        return {};
      default:
        io.render(theme.warn(`Comando desconhecido: /${cmd.name}. Use /help.`));
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
            ? `${theme.accent(theme.symbols.pointer)} ${theme.success(`${m} (ativo)`)}`
            : `  ${m}`,
        );
      io.render([theme.heading('Modelos disponíveis'), ...lines].join('\n'));
      return {};
    }
    const ok = models.setActive(args[0]);
    io.render(
      ok
        ? theme.success(`${theme.symbols.ok} Modelo ativo agora: ${args[0]}`)
        : theme.error(`${theme.symbols.fail} Modelo não encontrado: ${args[0]}`),
    );
    return {};
  }

  statusText(): string {
    const { theme, kernel, blackboard, models, usage } = this.d;
    const bb = blackboard.stats();
    return [
      theme.banner('Status do CloverOS'),
      `  Kernel: ${theme.success(String(kernel.listTools().length))} tools registradas`,
      `  Modelo ativo: ${theme.success(models.current)}`,
      `  Blackboard: ${theme.accent(String(bb.entries))} entradas em ${bb.topics.length} tópicos`,
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
      io.render(theme.dim(`Anexos detectados: ${tags}`));
    }
    const goal: Goal = { id: `goal-${++goalSeq}`, text: clean, workspacePath };
    try {
      const run = await agent.run(goal);
      if (run.result.status === 'done') {
        io.render(`${theme.statusIcon('ok')} ${formatOutputs(run.result.outputs)}`);
      } else {
        io.render(theme.error(`${theme.symbols.fail} Falhou: ${run.result.fault?.message ?? 'desconhecido'}`));
      }
    } catch (err) {
      io.render(theme.error(`${theme.symbols.fail} Erro: ${err instanceof Error ? err.message : String(err)}`));
    }
    return {};
  }

  helpText(): string {
    const { theme } = this.d;
    return [
      theme.banner('Comandos do REPL'),
      '  /help            mostra esta ajuda',
      '  /model [nome]     lista ou troca o modelo ativo',
      '  /status          saúde do Kernel e do Blackboard',
      '  /clear           limpa a tela',
      '  /exit            sai do REPL',
      theme.dim('  Qualquer outro texto vira uma tarefa para o agente.'),
      theme.dim('  Caminhos de arquivo/imagem viram tags limpas automaticamente.'),
    ].join('\n');
  }
}

function formatOutputs(outputs: unknown[]): string {
  if (!outputs || outputs.length === 0) return '(sem saída)';
  return outputs.map((o) => (typeof o === 'string' ? o : JSON.stringify(o))).join('\n');
}
