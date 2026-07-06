#!/usr/bin/env node
/**
 * CloverOS CLI — ponto de entrada (glue). Dispatch de argv (setup/help/REPL),
 * wiring do ecossistema, resiliência catastrófica e o loop do REPL.
 */

import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { ChatHistory } from './chat-history.js';

import { Agent } from '@clover/agent';
import { Blackboard } from '@clover/blackboard';
import { ConfigStore } from '@clover/config';
import { ContextBuilder } from '@clover/context-builder';
import type { CapabilityToken, Goal } from '@clover/contracts';
import { createI18n, LANGUAGES, type Lang } from '@clover/i18n';
import { createKernel, demoTools } from '@clover/kernel';
import { cloverTools, setCatalog } from '@clover/tools';
import type { LlmProvider, StructuredRequest } from '@clover/llm';
import { OllamaProvider, OpenAiCompatibleAdapter } from '@clover/llm';
import { Planner } from '@clover/planner';
import {
  ExecutionGovernor,
  ResourceManager,
  type ApprovalPrompt,
  type AuditSink,
  type AuthContext,
} from '@clover/resource-manager';
import { ProcessSandbox } from '@clover/sandbox';
import { DurableScheduler } from '@clover/scheduler';
import { EventStore } from '@clover/state';
import { LexicalToolSearch } from '@clover/tool-search';
import { ChoicePrompt, StatusBoard, UsageCounter, createTheme, phaseLabel } from '@clover/tui';

import { ModelRegistry, ReplEngine, buildExecConfirmation } from './repl-engine.js';
import { ToolCallingAgent } from './tool-agent.js';
import { installResilience } from './resilience.js';
import { renderSteps, runSetup, type SetupProbes } from './setup.js';
import { clearScreen, createLineReader, promptChoice, promptSecret, render, withSpinner, withSpinnerSuspended } from './terminal.js';

/** Localiza a raiz do monorepo subindo até achar pnpm-workspace.yaml. */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

const ROOT = findRepoRoot(process.cwd());
const OLLAMA_HOST = process.env.CLOVER_OLLAMA_HOST ?? 'http://localhost:11434';
const DEFAULT_MODEL = process.env.CLOVER_MODEL ?? 'qwen2.5-coder';

function loadModels(): string[] {
  try {
    const raw = readFileSync(join(ROOT, 'config', 'models.config.json'), 'utf8');
    const cfg = JSON.parse(raw) as { models?: Array<{ name: string }> };
    const names = (cfg.models ?? []).map((m) => m.name).filter(Boolean);
    if (names.length > 0) return names;
  } catch {
    /* usa o fallback */
  }
  return [DEFAULT_MODEL, 'deepseek-coder'];
}

// --- setup probes reais -----------------------------------------------------

function buildRealProbes(): SetupProbes {
  const WIN = process.platform === 'win32';
  const ok = (cmd: string, args: string[]): boolean => {
    try {
      return spawnSync(cmd, args, { stdio: 'ignore', shell: WIN }).status === 0;
    } catch {
      return false;
    }
  };
  return {
    nodeVersion: () => process.version,
    pnpmAvailable: async () => ok('pnpm', ['--version']),
    nodeModulesExists: () => existsSync(join(ROOT, 'node_modules')),
    buildExists: () => existsSync(join(ROOT, 'packages', 'kernel', 'dist', 'index.js')),
    installDeps: async () => {
      spawnSync('pnpm', ['install'], { cwd: ROOT, stdio: 'inherit', shell: WIN });
    },
    buildTs: async () => {
      spawnSync('pnpm', ['exec', 'tsc', '--build', 'apps/cli/tsconfig.json'], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: WIN,
      });
    },
    ollamaRunning: async () => {
      try {
        const r = await fetch(`${OLLAMA_HOST}/api/tags`);
        return r.ok;
      } catch {
        return false;
      }
    },
    startOllama: async () => {
      try {
        spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref();
        await new Promise((r) => setTimeout(r, 1500));
        const r = await fetch(`${OLLAMA_HOST}/api/tags`);
        return r.ok;
      } catch {
        return false;
      }
    },
    modelPresent: async (model) => {
      try {
        const r = await fetch(`${OLLAMA_HOST}/api/tags`);
        if (!r.ok) return false;
        const data = (await r.json()) as { models?: Array<{ name: string }> };
        return (data.models ?? []).some((m) => m.name === model || m.name.startsWith(`${model}:`));
      } catch {
        return false;
      }
    },
    pullModel: async (model) => {
      await fetch(`${OLLAMA_HOST}/api/pull`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: model, stream: false }),
      });
    },
  };
}

// --- subcomandos ------------------------------------------------------------

async function cmdSetup(checkOnly: boolean): Promise<void> {
  const theme = createTheme();
  render(theme.dim('Verificando o ambiente do CloverOS...'));
  const steps = await runSetup(buildRealProbes(), { model: DEFAULT_MODEL, checkOnly });
  render(renderSteps(steps, theme));
  const failed = steps.some((s) => s.status === 'fail');
  process.exit(failed ? 1 : 0);
}

function cmdHelp(): void {
  const theme = createTheme();
  render(
    [
      theme.banner('CloverOS CLI'),
      '',
      theme.heading('Uso'),
      '  clover            inicia o REPL interativo',
      '  clover setup      sanity check idempotente do ambiente',
      '  clover setup --check   apenas diagnostica (sem corrigir)',
      '  clover --help     esta ajuda',
      '',
      theme.heading('Comandos do REPL'),
      '  /help · /model [nome] · /status · /clear · /exit',
      '  /config           painel interativo (idioma, modelo, log, modo)',
      '  /mode [step|auto] alterna a autonomia (confirmações)',
      '  /provider         adiciona/ativa um provedor (OpenRouter/OpenAI/Groq/...)',
      '  /exec <comando>   roda no Sandbox Tier 3 (pede autorização)',
    ].join('\n'),
  );
}

async function cmdRepl(opts: { resume?: boolean; sessionId?: string } = {}): Promise<void> {
  const theme = createTheme();
  const config = new ConfigStore();
  const i18n = createI18n(config.getValue('language'));
  const blackboard = new Blackboard({ filePath: join(ROOT, '.clover', 'blackboard.jsonl') });

  // Resiliência: nada de stack trace cru; persiste no Blackboard e sai limpo.
  installResilience({ blackboard, theme, render, exit: (c) => process.exit(c) });

  const reader = createLineReader();

  // Governor: a trava de autorização/auditoria que o Kernel injeta no Executor.
  // Invariante: o CLI SEMPRE injeta o Governor — tools write/destructive nunca
  // rodam sem trava (o Executor é fail-safe sem ele). O modo é lido AO VIVO da
  // config (o usuário troca via /mode ou /config sem reconstruir o kernel).
  const auditSink: AuditSink = (e) => {
    blackboard.post({ topic: 'audit', author: 'governor', payload: e });
    // Método NÃO destacado da instância (destacar perdia o `this` → crash
    // "Cannot read properties of undefined (reading 'paint')").
    const line = `[audit] ${e.tool} (${e.intent}) → ${e.decision}${e.reason ? ` — ${e.reason}` : ''}`;
    render(e.decision === 'allowed' ? theme.dim(line) : theme.warn(line));
  };
  const approvalPrompt: ApprovalPrompt = (ctx: AuthContext) =>
    withSpinnerSuspended(async () => {
      const ans = (await reader.question(theme.warn(`Autorizar ${ctx.tool} (${ctx.intent})? (s/N) `)))
        .trim()
        .toLowerCase();
      return ans === 's' || ans === 'sim' || ans === 'y' || ans === 'yes';
    });
  const stepGovernor = new ExecutionGovernor({ mode: 'step', prompt: approvalPrompt, audit: auditSink, perToolTimeoutMs: 60_000 });
  const autoGovernor = new ExecutionGovernor({ mode: 'auto', audit: auditSink, perToolTimeoutMs: 60_000 });
  const activeGovernor = (): ExecutionGovernor =>
    config.getValue('mode') === 'auto' ? autoGovernor : stepGovernor;

  // Arsenal: tools base (echo/concat/respond) + departamentos (@clover/tools).
  // Registrar no Kernel já as torna visíveis ao Planner e ao Context Builder
  // (Agent → kernel.listTools() → ToolSearch → ContextBuilder → Planner).
  const kernel = createKernel([...demoTools, ...cloverTools], {
    authorize: (req) => activeGovernor().authorize({ ...req }),
    guard: (fn) => activeGovernor().guard(fn),
  });
  // Popula o catálogo da tool list_available_tools com os descritores reais.
  setCatalog(kernel.listTools());
  const scheduler = new DurableScheduler(kernel, new EventStore({ filePath: join(ROOT, '.clover', 'journal.jsonl') }));
  const models = new ModelRegistry(loadModels(), config.getValue('defaultModel'));
  const usage = new UsageCounter();

  // Provider DINÂMICO: lê o provedor ativo da config a cada chamada — Ollama ou
  // qualquer OpenAI-compatible (OpenRouter/Groq/DeepSeek/OpenAI).
  const provider: LlmProvider = {
    name: 'dynamic',
    completeStructured: (req: StructuredRequest) => {
      const pc = config.activeProviderConfig();
      if (pc.kind === 'openai-compatible' && pc.baseURL) {
        return new OpenAiCompatibleAdapter({
          baseURL: pc.baseURL,
          apiKey: pc.apiKey,
          model: pc.model ?? models.current,
          supportsStructuredOutputs: pc.supportsStructuredOutputs,
        }).completeStructured(req);
      }
      return new OllamaProvider({ host: pc.baseURL ?? OLLAMA_HOST, model: pc.model ?? models.current }).completeStructured(req);
    },
    complete: (req) => {
      const pc = config.activeProviderConfig();
      if (pc.kind === 'openai-compatible' && pc.baseURL) {
        return new OpenAiCompatibleAdapter({
          baseURL: pc.baseURL,
          apiKey: pc.apiKey,
          model: pc.model ?? models.current,
          supportsStructuredOutputs: pc.supportsStructuredOutputs,
        }).complete!(req);
      }
      return new OllamaProvider({ host: pc.baseURL ?? OLLAMA_HOST, model: pc.model ?? models.current }).complete!(req);
    },
    completeWithTools: (req) => {
      const pc = config.activeProviderConfig();
      if (pc.kind === 'openai-compatible' && pc.baseURL) {
        return new OpenAiCompatibleAdapter({
          baseURL: pc.baseURL,
          apiKey: pc.apiKey,
          model: pc.model ?? models.current,
          supportsStructuredOutputs: pc.supportsStructuredOutputs,
        }).completeWithTools!(req);
      }
      return new OllamaProvider({ host: pc.baseURL ?? OLLAMA_HOST, model: pc.model ?? models.current }).completeWithTools!(req);
    },
  };

  const agent = new Agent({
    kernel,
    scheduler,
    planner: new Planner(provider),
    contextBuilder: new ContextBuilder(),
    resourceManager: new ResourceManager({ maxConcurrent: 4 }),
    toolSearch: new LexicalToolSearch(),
    budget: { maxTokens: 12_000 },
    maxTools: 8,
  });

  const chatHistory = new ChatHistory(join(ROOT, '.clover', 'chat-history.jsonl'));

  // --resume: continue from the last recorded session (or specified sessionId).
  let sessionId = randomUUID();
  let resumedTurns = 0;
  if (opts.resume) {
    const targetId = opts.sessionId ?? chatHistory.lastSessionId();
    if (targetId) {
      const turns = chatHistory.loadSession(targetId);
      if (turns.length > 0) {
        sessionId = targetId as ReturnType<typeof randomUUID>;
        resumedTurns = turns.length;
      }
    }
  }

  const toolAgent = new ToolCallingAgent(provider, kernel, ROOT, new LexicalToolSearch());

  const engine = new ReplEngine({
    theme,
    i18n,
    io: { render, clear: clearScreen },
    agent,
    kernel,
    blackboard,
    config,
    models,
    usage,
    workspacePath: ROOT,
    chatHistory,
    sessionId,
    chatProvider: { complete: (req) => provider.complete!(req) },
    toolAgent,
  });

  // If resuming, pre-load the previous session's turns into the engine.
  if (opts.resume && resumedTurns > 0) {
    const targetId = opts.sessionId ?? chatHistory.lastSessionId()!;
    engine.loadTurns(
      chatHistory.loadSession(targetId).map((t) => ({ user: t.user, assistant: t.assistant })),
    );
  }

  const sandbox = new ProcessSandbox();
  let alwaysExec = false;

  clearScreen();
  render(engine.banner());
  if (opts.resume && resumedTurns > 0) {
    render(theme.dim(`↩  Retomando sessão anterior (${resumedTurns} turno${resumedTurns !== 1 ? 's' : ''} carregados como contexto).`));
  }

  for (;;) {
    const line = (await reader.question(theme.accent(`\n${theme.symbols.clover} > `))).trim();
    if (!line) continue;

    if (line.startsWith('/exec ')) {
      await handleExec(line.slice(6).trim());
      continue;
    }
    if (line === '/config') {
      await handleConfig();
      continue;
    }
    if (line === '/provider') {
      await handleProvider();
      continue;
    }

    if (line.startsWith('/')) {
      const res = await engine.handleLine(line);
      if (res.exit) break;
      continue;
    }

    // Tarefa: spinner vivo (anti-freeze) com raciocínio dinâmico do Event Bus.
    const board = new StatusBoard();
    let lastTopic = 'task:submitted';
    const unsub = kernel.events.subscribe('*', (e) => {
      lastTopic = e.topic;
      if (e.topic === 'node:start') board.add(e.spanId ?? e.id, phaseLabel(e.topic));
    });
    await withSpinner(
      () => `${phaseLabel(lastTopic)}${board.activeCount > 1 ? ` (${board.activeCount} atores)` : ''}  ${usage.format()}`,
      theme,
      () => engine.handleLine(line),
    );
    unsub();
  }

  reader.close();
  render(theme.success(`${theme.symbols.clover} ${i18n.t('repl.sessionEnded')}`));

  // Painel de configuração (raw mode, setas — sem vazar input).
  async function handleConfig(): Promise<void> {
    const fields = [
      { value: 'language', label: i18n.t('config.language'), choices: LANGUAGES.map((l) => ({ label: l, value: l })) },
      { value: 'defaultModel', label: i18n.t('config.defaultModel'), choices: models.list().map((m) => ({ label: m, value: m })) },
      { value: 'logLevel', label: i18n.t('config.logLevel'), choices: ['silent', 'info', 'debug'].map((v) => ({ label: v, value: v })) },
      { value: 'mode', label: i18n.t('config.mode'), choices: [{ label: 'step', value: 'step' }, { label: 'auto', value: 'auto' }] },
    ];
    const pick = await promptChoice(
      new ChoicePrompt(i18n.t('config.pickField'), fields.map((f) => ({ label: f.label, value: f.value }))),
      theme,
    );
    if (pick.cancelled || !pick.value) return render(theme.dim(i18n.t('config.cancelled')));
    const field = fields.find((f) => f.value === pick.value)!;
    const choice = await promptChoice(new ChoicePrompt(i18n.t('config.pickValue', { field: field.label }), field.choices), theme);
    if (choice.cancelled || !choice.value) return render(theme.dim(i18n.t('config.cancelled')));
    (config.set as (k: string, v: unknown) => void)(field.value, choice.value);
    if (field.value === 'language') i18n.setLang(choice.value as Lang);
    render(theme.success(`${theme.symbols.ok} ${i18n.t('config.saved', { path: config.path() })}`));
  }

  // Adiciona um provedor de nuvem; a API Key é digitada com bloqueio visual.
  async function handleProvider(): Promise<void> {
    const name = (await reader.question(`${theme.accent(i18n.t('provider.addName'))}: `)).trim();
    if (!name) return render(theme.dim(i18n.t('provider.cancelled')));
    const baseURL = (await reader.question(`${theme.accent(i18n.t('provider.baseUrl'))}: `)).trim();
    const apiKey = await promptSecret(i18n.t('provider.apiKey'), theme);
    if (apiKey === null) return render(theme.dim(i18n.t('provider.cancelled')));
    const sup = await promptChoice(
      new ChoicePrompt('Structured outputs?', [{ label: 'yes', value: 'yes' }, { label: 'no', value: 'no' }]),
      theme,
    );
    config.setProvider(name, { kind: 'openai-compatible', baseURL, apiKey, supportsStructuredOutputs: sup.value === 'yes' });
    config.setActiveProvider(name);
    render(theme.success(`${theme.symbols.ok} ${i18n.t('provider.saved', { name })}`));
  }

  async function handleExec(command: string): Promise<void> {
    if (!command) {
      render(theme.warn(i18n.t('exec.usage')));
      return;
    }
    const [argv0, ...args] = command.split(/\s+/);
    // /exec é uma porta SEPARADA ao Sandbox (comando explícito do usuário).
    // Mantém sua UX dedicada (cancel/once/always) mas compartilha a AUDITORIA do
    // Governor — nenhuma escrita fica sem trilha. Modo auto: sem confirmação.
    const auto = config.getValue('mode') === 'auto';
    if (!auto && !alwaysExec) {
      const choice = await promptChoice(buildExecConfirmation(command, i18n), theme);
      const denied = choice.cancelled || choice.value === 'cancel';
      auditSink({
        ts: Date.now(),
        tool: argv0,
        intent: 'destructive',
        taskId: 'cli-exec',
        traceId: 'cli-exec',
        mode: 'step',
        decision: denied ? 'denied' : 'allowed',
      });
      if (denied) {
        render(theme.dim(i18n.t('exec.cancelled')));
        return;
      }
      if (choice.value === 'always') alwaysExec = true;
    } else {
      auditSink({
        ts: Date.now(),
        tool: argv0,
        intent: 'destructive',
        taskId: 'cli-exec',
        traceId: 'cli-exec',
        mode: auto ? 'auto' : 'step',
        decision: 'allowed',
        reason: alwaysExec ? 'always (sessão)' : undefined,
      });
    }
    const token: CapabilityToken = {
      id: 'cli-exec',
      taskId: 'cli-exec',
      caps: [{ kind: 'proc.exec', argv0Allow: [argv0], maxProcs: 1 }],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      sig: 'cli',
    };
    try {
      const result = await sandbox.run({
        argv: [argv0, ...args],
        cwd: ROOT,
        workspacePath: ROOT,
        token,
        timeoutMs: 15_000,
      });
      if (result.stdout) render(result.stdout.trimEnd());
      if (result.stderr) render(theme.warn(result.stderr.trimEnd()));
      const tag = result.timedOut
        ? theme.error(`${theme.symbols.fail} timeout`)
        : theme.dim(`exit ${result.exitCode}`);
      render(tag);
      blackboard.post({ topic: 'exec', author: 'cli', payload: { command, exitCode: result.exitCode } });
    } catch (err) {
      render(theme.error(`${theme.symbols.fail} ${err instanceof Error ? err.message : String(err)}`));
    }
  }
}

// --- dispatch ---------------------------------------------------------------

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === 'setup') {
    await cmdSetup(rest.includes('--check'));
    return;
  }
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    cmdHelp();
    return;
  }
  if (cmd === '--resume' || (cmd === undefined && rest.includes('--resume'))) {
    const sidFlag = rest.find((a) => a.startsWith('--session='));
    const sessionId = sidFlag ? sidFlag.split('=')[1] : undefined;
    await cmdRepl({ resume: true, sessionId });
    return;
  }
  await cmdRepl();
}

void main();
