#!/usr/bin/env node
/**
 * CloverOS CLI — ponto de entrada (glue). Dispatch de argv (setup/help/REPL),
 * wiring do ecossistema, resiliência catastrófica e o loop do REPL.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

import { Agent } from '@clover/agent';
import { Blackboard } from '@clover/blackboard';
import { ContextBuilder } from '@clover/context-builder';
import type { CapabilityToken, Goal } from '@clover/contracts';
import { createKernel, demoTools } from '@clover/kernel';
import type { LlmProvider, StructuredRequest } from '@clover/llm';
import { OllamaProvider } from '@clover/llm';
import { Planner } from '@clover/planner';
import { ResourceManager } from '@clover/resource-manager';
import { ProcessSandbox } from '@clover/sandbox';
import { DurableScheduler } from '@clover/scheduler';
import { EventStore } from '@clover/state';
import { LexicalToolSearch } from '@clover/tool-search';
import { StatusBoard, UsageCounter, createTheme, phaseLabel } from '@clover/tui';

import { ModelRegistry, ReplEngine, buildExecConfirmation } from './repl-engine.js';
import { installResilience } from './resilience.js';
import { renderSteps, runSetup, type SetupProbes } from './setup.js';
import { clearScreen, createLineReader, promptChoice, render, withSpinner } from './terminal.js';

const ROOT = process.cwd();
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
  const ok = (cmd: string, args: string[]): boolean => {
    try {
      return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
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
      spawnSync('pnpm', ['install'], { cwd: ROOT, stdio: 'inherit' });
    },
    buildTs: async () => {
      spawnSync('pnpm', ['exec', 'tsc', '--build', 'apps/cli/tsconfig.json'], {
        cwd: ROOT,
        stdio: 'inherit',
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
      '  /exec <comando>   roda no Sandbox Tier 3 (pede autorização)',
    ].join('\n'),
  );
}

async function cmdRepl(): Promise<void> {
  const theme = createTheme();
  const blackboard = new Blackboard({ filePath: join(ROOT, '.clover', 'blackboard.jsonl') });

  // Resiliência: nada de stack trace cru; persiste no Blackboard e sai limpo.
  installResilience({ blackboard, theme, render, exit: (c) => process.exit(c) });

  const kernel = createKernel(demoTools);
  const scheduler = new DurableScheduler(kernel, new EventStore({ filePath: join(ROOT, '.clover', 'journal.jsonl') }));
  const models = new ModelRegistry(loadModels(), DEFAULT_MODEL);
  const usage = new UsageCounter();

  // Provider que respeita o modelo ativo (trocável via /model).
  const provider: LlmProvider = {
    name: 'ollama',
    completeStructured: (req: StructuredRequest) =>
      new OllamaProvider({ host: OLLAMA_HOST, model: models.current }).completeStructured(req),
  };

  const agent = new Agent({
    kernel,
    scheduler,
    planner: new Planner(provider),
    contextBuilder: new ContextBuilder(),
    resourceManager: new ResourceManager({ maxConcurrent: 4 }),
    toolSearch: new LexicalToolSearch(),
    budget: { maxTokens: 4096 },
    maxTools: 8,
  });

  const engine = new ReplEngine({
    theme,
    io: { render, clear: clearScreen },
    agent,
    kernel,
    blackboard,
    models,
    usage,
    workspacePath: ROOT,
  });

  const sandbox = new ProcessSandbox();
  const reader = createLineReader();
  let alwaysExec = false;

  clearScreen();
  render(engine.banner());

  for (;;) {
    const line = (await reader.question(theme.accent(`\n${theme.symbols.clover} > `))).trim();
    if (!line) continue;

    if (line.startsWith('/exec ')) {
      await handleExec(line.slice(6).trim());
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
  render(theme.success(`${theme.symbols.clover} Sessão encerrada.`));

  async function handleExec(command: string): Promise<void> {
    if (!command) {
      render(theme.warn('Uso: /exec <comando>'));
      return;
    }
    if (!alwaysExec) {
      const choice = await promptChoice(buildExecConfirmation(command), theme);
      if (choice.cancelled || choice.value === 'cancel') {
        render(theme.dim('Execução cancelada.'));
        return;
      }
      if (choice.value === 'always') alwaysExec = true;
    }
    const [argv0, ...args] = command.split(/\s+/);
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
  await cmdRepl();
}

void main();
