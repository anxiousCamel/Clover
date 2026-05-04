#!/usr/bin/env node
/**
 * Clover CLI — interactive REPL that boots the backend and lets you
 * chat directly in the terminal.
 *
 * Usage: pnpm --filter @clover/backend run cli
 *   or:  node dist/cli.js
 *
 * @module cli
 */

import * as readline from 'node:readline';
import chalk from 'chalk';
import boxen from 'boxen';
import figlet from 'figlet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import gradient from 'gradient-string';
import { config } from './config/config.js';
import { SQLiteStore } from './storage/sqlite.store.js';
import * as lancedb from './memory/lancedb.adapter.js';
import * as sessionManager from './orchestrator/session.manager.js';
import * as toolRegistry from './tools/tool-registry.js';
import * as agentEngine from './agents/agent-engine.js';
import * as ollamaClient from './ollama/ollama.client.js';
import * as memoryService from './memory/memory.service.js';
import * as taskService from './orchestrator/task.service.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { initPipelineLogger } from './pipeline/index.js';

// ---------------------------------------------------------------------------
// Colors & Styling
// ---------------------------------------------------------------------------

const cloverGradient = gradient(['#22c55e', '#a3e635', '#fde047']); // Green to Lime to Yellow
const highlight = chalk.hex('#a3e635');
const dim = chalk.gray;

const CLOVER_RAW = `
 ██████╗██╗      ██████╗ ██╗   ██╗███████╗██████╗
██╔════╝██║     ██╔═══██╗██║   ██║██╔════╝██╔══██╗
██║     ██║     ██║   ██║██║   ██║█████╗  ██████╔╝
██║     ██║     ██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██╗
╚██████╗███████╗╚██████╔╝ ╚████╔╝ ███████╗██║  ██║
 ╚═════╝╚══════╝ ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝
`.trim();

// ---------------------------------------------------------------------------
// Live Status — animated spinner + elapsed time + token count
// ---------------------------------------------------------------------------

class LiveStatus {
  private frames = ['⣾','⣽','⣻','⢿','⡿','⣟','⣯','⣷'];
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private phase: 'idle'|'thinking'|'tool' = 'idle';
  private startMs = 0;
  private toolName = '';

  begin(phase: 'thinking'|'tool', tool?: string) {
    if (this.phase === 'idle') this.startMs = Date.now();
    this.phase = phase;
    this.toolName = tool ?? '';
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), 80);
    }
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.phase = 'idle';
  }

  clear() {
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
  }

  elapsed(): string {
    return ((Date.now() - this.startMs) / 1000).toFixed(1);
  }

  private tick() {
    this.frame = (this.frame + 1) % this.frames.length;
    const spin = chalk.green(this.frames[this.frame]);
    const t = chalk.gray(this.elapsed() + 's');
    const label = this.phase === 'tool' ? dim(this.toolName) : dim('pensando...');
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(`${chalk.cyan('clover › ')}${spin} ${label} ${t}`);
  }
}

async function renderBanner() {
  const title = figlet.textSync('CLOVER', { font: 'ANSI Shadow' });

  console.clear();
  console.log(cloverGradient(title));
  console.log(`\n 🍀 ${chalk.white('Any model. Every tool. Zero limits.')} 🍀\n`);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<{ sessionId: string }> {
  await renderBanner();

  // SQLite
  const store = new SQLiteStore('./data/clover.db');
  await store.ensureReady();

  // LanceDB
  let lancedbStatus = 'Active';
  try {
    await lancedb.init(config.memory.dbPath);
  } catch {
    lancedbStatus = 'Skipped';
  }

  // Session manager & Task service
  sessionManager.init(store);
  taskService.init(store);

  // Pipeline logger
  initPipelineLogger(process.cwd());

  // Tools
  await toolRegistry.loadPlugins();
  const toolCount = toolRegistry.listTools().length;

  // Agents
  await agentEngine.loadAgents();
  const agentCount = agentEngine.listAgents().length;

  // Check Ollama
  let ollamaStatus = 'Not reachable';
  let modelInfo = 'N/A';
  try {
    const models = await ollamaClient.listModels();
    ollamaStatus = 'Active';
    modelInfo = models.length > 0 ? `Ollama (${models[0].name})` : 'Ollama (No models)';
  } catch {
    // keep defaults
  }

  // Create session
  const session = sessionManager.createSession(process.cwd());

  // Render Status Box
  const statusContent = [
    `${chalk.white('Clover System:')}  🍀 ${chalk.green('Active')}`,
    `${chalk.white('Core LLM:')}       ${highlight(modelInfo)}`,
    `${chalk.white('Backend:')}        ${dim(config.ollama.host)}`,
  ].join('\n');

  console.log(boxen(statusContent, {
    padding: 1,
    margin: { bottom: 1 },
    borderColor: '#22c55e',
    borderStyle: 'round',
  }));

  console.log(chalk.green(`● 🍀 clover Ready ${dim('— type /help to begin')}`));
  console.log(`${chalk.white('Clover>')} ${highlight('clover-cli v1.0.0')}\n`);

  return { sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Chat loop
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dynamic confirmation options
// ---------------------------------------------------------------------------

type ConfirmAction = 'allow' | 'deny' | 'edit';
interface ConfirmOption {
  label: string;
  action: ConfirmAction;
  field?: string;
  editPrompt?: string;
}

function getConfirmOptions(toolName: string, args: Record<string, any>): ConfirmOption[] {
  const trunc = (s: string, n = 60) => String(s ?? '').slice(0, n);
  switch (toolName) {
    case 'execute-command':
      return [
        { label: `executar  ${chalk.magenta(trunc(args.command))}`, action: 'allow' },
        { label: 'editar comando', action: 'edit', field: 'command', editPrompt: 'Comando' },
        { label: 'negar', action: 'deny' },
      ];
    case 'write-file':
      return [
        { label: `escrever → ${highlight(trunc(args.path))}`, action: 'allow' },
        { label: 'mudar caminho', action: 'edit', field: 'path', editPrompt: 'Caminho' },
        { label: 'negar', action: 'deny' },
      ];
    case 'edit-file':
      return [
        { label: `editar → ${highlight(trunc(args.path))}`, action: 'allow' },
        { label: 'mudar caminho', action: 'edit', field: 'path', editPrompt: 'Caminho' },
        { label: 'negar', action: 'deny' },
      ];
    case 'read-file':
      return [
        { label: `ler → ${highlight(trunc(args.path))}`, action: 'allow' },
        { label: 'mudar caminho', action: 'edit', field: 'path', editPrompt: 'Caminho' },
        { label: 'negar', action: 'deny' },
      ];
    case 'list-files':
      return [
        { label: `listar → ${highlight(trunc(args.directory ?? '.'))}`, action: 'allow' },
        { label: 'mudar diretório', action: 'edit', field: 'directory', editPrompt: 'Diretório' },
        { label: 'negar', action: 'deny' },
      ];
    case 'search-online':
      return [
        { label: `buscar  "${trunc(args.query)}"`, action: 'allow' },
        { label: 'editar busca', action: 'edit', field: 'query', editPrompt: 'Busca' },
        { label: 'negar', action: 'deny' },
      ];
    case 'search-memory':
      return [
        { label: `buscar memória  "${trunc(args.query)}"`, action: 'allow' },
        { label: 'negar', action: 'deny' },
      ];
    default: {
      const fields = Object.entries(args as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .slice(0, 2);
      const editOpts: ConfirmOption[] = fields.map(([k]) => ({
        label: `editar ${k}`,
        action: 'edit',
        field: k,
        editPrompt: k,
      }));
      return [
        { label: 'permitir', action: 'allow' },
        ...editOpts,
        { label: 'negar', action: 'deny' },
      ];
    }
  }
}

function findWorkspaceRoot(startPath: string): string {
  let current = path.resolve(startPath);
  const root = path.parse(current).root;
  while (current !== root) {
    if (
      existsSync(path.join(current, 'pnpm-workspace.yaml')) ||
      existsSync(path.join(current, '.git'))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  return startPath;
}

async function chat(
  sessionId: string,
  userMessage: string,
  rl: readline.Interface,
  verboseTools = false,
): Promise<string> {
  const workspacePath = findWorkspaceRoot(process.cwd());

  // RAG search (best-effort)
  let memoryChunks: any[] = [];
  try {
    memoryChunks = await memoryService.search(userMessage, 5);
  } catch {
    // skip
  }

  const messages: Message[] = [
    ...sessionManager.loadHistory(sessionId),
    { role: 'user', content: userMessage },
  ];

  // Map tools to Ollama format
  const availableTools = toolRegistry.listTools().map(name => {
    const plugin = toolRegistry.getPlugin(name)!;
    const schema = zodToJsonSchema(plugin.inputSchema as any) as any;
    delete schema.$schema;
    return {
      type: 'function' as const,
      function: { name: plugin.name, description: plugin.description, parameters: schema },
    };
  });

  const status = new LiveStatus();
  let hasOutput = false;
  let summaryShown = false;
  const toolResults: Array<{tool: string, success: boolean, output: string}> = [];

  const showSummary = (inp: number, out: number) => {
    if (summaryShown) return;
    summaryShown = true;
    const t = status.elapsed();
    process.stdout.write(
      '\n' + chalk.gray(`  ${t}s · ↑${inp} ↓${out} tok`) + '\n'
    );
  };

  // Dispatch to agent engine
  const result = await agentEngine.dispatch(
    { messages, tools: availableTools, model: 'qwen2.5-coder:14b' },
    sessionId,
    {
      workspacePath,
      onConfirmationRequired: async (toolName, args: any) => {
        status.stop();
        status.clear();

        const options = getConfirmOptions(toolName, args as Record<string, any>);

        process.stdout.write(`\n${chalk.yellow('⚠️')} ${chalk.cyan(toolName)}\n`);
        options.forEach((opt, i) => {
          const num = chalk.yellow(`${i + 1}.`);
          const label =
            opt.action === 'deny' ? chalk.red(opt.label) :
            opt.action === 'edit' ? chalk.blue(opt.label) :
            chalk.green(opt.label);
          process.stdout.write(`  ${num} ${label}\n`);
        });
        process.stdout.write('\n');

        return new Promise<boolean>((resolve) => {
          if (process.stdin.isTTY) process.stdin.setRawMode(true);
          process.stdin.resume();

          const handler = (data: Buffer) => {
            const key = data[0];
            if (key === 3) { process.stdout.write('\n'); process.exit(0); }
            const digit = key - 48;
            if (digit < 1 || digit > options.length) return; // invalid key — keep listening

            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            process.stdin.removeListener('data', handler);
            // Clear any double-echo then write single clean echo
            readline.cursorTo(process.stdout, 0);
            readline.clearLine(process.stdout, 0);
            process.stdout.write(chalk.yellow(String(digit)) + '\n');
            // Flush readline's internal buffer so digit doesn't leak as next input
            (rl as any).line = '';
            (rl as any).cursor = 0;

            const chosen = options[digit - 1];
            if (chosen.action === 'allow') {
              resolve(true);
            } else if (chosen.action === 'deny') {
              resolve(false);
            } else {
              // edit — show inline input, update args in-place, then allow
              rl.resume();
              rl.question(chalk.yellow(`  ${chosen.editPrompt}: `), (newVal) => {
                rl.pause();
                if (newVal.trim()) args[chosen.field!] = newVal.trim();
                resolve(true);
              });
            }
          };

          process.stdin.on('data', handler);
        });
      },

      emit: (type, data: any) => {
        if (type === 'agent:status' && data.status === 'running') {
          if (!hasOutput) status.begin('thinking');

        } else if (type === 'tool:executing') {
          status.begin('tool', data.toolName);

        } else if (type === 'tool:result') {
          toolResults.push({
            tool: data.toolName || 'unknown',
            success: !!data.success,
            output: data.output || data.error || '',
          });
          if (data.success) {
            if (verboseTools && data.output) {
              status.stop();
              status.clear();
              const out = String(data.output).slice(0, 400);
              process.stdout.write(`  ${chalk.green('✓')} ${dim(data.toolName)} ${chalk.gray(out)}\n`);
            } else {
              status.begin('thinking');
            }
          } else {
            status.stop();
            status.clear();
            const errMsg = data.error || data.output || `Tool "${data.toolName}" failed`;
            process.stdout.write(`  ${chalk.red('✗')} ${dim(errMsg)}\n`);
          }

        } else if (type === 'message:token') {
          if (!hasOutput && data.token) {
            status.stop();
            status.clear();
            process.stdout.write('\n' + chalk.cyan('clover › '));
            hasOutput = true;
          }
          if (data.token) process.stdout.write(data.token);

        } else if (type === 'message:done') {
          status.stop();
          const inp: number = data.usage?.inputTokens ?? 0;
          const out: number = data.usage?.outputTokens ?? 0;
          showSummary(inp, out);
        }
      },
    }
  );

  const response = result.text;

  // Pipeline responses aren't streamed — print them now
  if (result.agent === 'pipeline' && response) {
    status.stop();
    status.clear();
    process.stdout.write('\n' + chalk.cyan('clover › '));
    console.log(response);
  }

  // Fallback summary if message:done wasn't emitted
  if (!summaryShown && hasOutput) showSummary(0, 0);

  // Save to history
  sessionManager.saveMessage(sessionId, { role: 'user', content: userMessage });
  if (toolResults.length > 0) {
    const toolSummary = toolResults.map(t =>
      `[Tool: ${t.tool}] ${t.success ? '✓' : '✗'} ${t.output}`
    ).join('\n');
    sessionManager.saveMessage(sessionId, {
      role: 'assistant',
      content: `${toolSummary}${response ? '\n' + response : ''}`,
    });
  } else if (response) {
    sessionManager.saveMessage(sessionId, { role: 'assistant', content: response });
  }

  // Index turn (best-effort)
  try {
    await memoryService.indexText(
      `User: ${userMessage}\nAssistant: ${response}`,
      { source: 'conversation' },
    );
  } catch {
    // skip
  }

  return response;
}

// ---------------------------------------------------------------------------
// REPL
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { sessionId } = await boot();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: highlight('you › '),
  });

  let verboseTools = false;

  // Keyboard shortcuts
  readline.emitKeypressEvents(process.stdin, rl);
  process.stdin.on('keypress', (_str, key) => {
    if (!key || pendingChat) return;
    // Ctrl+L — clear screen
    if (key.ctrl && key.name === 'l') {
      console.clear();
      rl.prompt(true);
      return;
    }
    // Ctrl+O — toggle verbose tool output
    if (key.ctrl && key.name === 'o') {
      verboseTools = !verboseTools;
      process.stdout.write('\r' + chalk.gray(`  verbose tools ${verboseTools ? chalk.green('ON') : chalk.red('OFF')}`) + '\n');
      rl.prompt(true);
      return;
    }
    // Shift+Tab — show shortcuts hint
    if (key.shift && key.name === 'tab') {
      process.stdout.write('\n' + chalk.gray(
        '  Ctrl+L  clear    Ctrl+O  verbose tools    Ctrl+C  exit\n'
      ));
      rl.prompt(true);
      return;
    }
  });

  console.log(dim('Type your message. Ctrl+C to exit. Shift+Tab for shortcuts.\n'));
  rl.prompt();

  let pendingChat: Promise<void> | null = null;

  rl.on('line', (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === '/quit' || input === '/exit') {
      console.log(`\n${dim('Bye!')}`);
      process.exit(0);
    }

    if (input === '/history') {
      const history = sessionManager.loadHistory(sessionId);
      for (const msg of history) {
        const prefix = msg.role === 'user' ? highlight('you') : chalk.cyan('clover');
        console.log(`${prefix}: ${msg.content.slice(0, 120)}`);
      }
      console.log();
      rl.prompt();
      return;
    }

    if (input === '/verbose') {
      verboseTools = !verboseTools;
      console.log(chalk.gray(`  verbose tools ${verboseTools ? chalk.green('ON') : chalk.red('OFF')}`));
      rl.prompt();
      return;
    }

    // Pause readline while waiting for response
    rl.pause();

    pendingChat = (async () => {
      try {
        await chat(sessionId, input, rl, verboseTools);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\n${chalk.red('Error:')} ${msg}`);
        if (msg.includes('Ollama returned HTTP 500')) {
          console.log(`${chalk.yellow('Tip:')} Ollama is struggling. Try a smaller model (e.g. qwen2.5:7b) or check your VRAM usage.`);
        }
      }
      console.log();
      if (!closing) {
        rl.resume();
        rl.prompt();
      }
      pendingChat = null;
    })();
  });

  let closing = false;
  rl.on('close', async () => {
    closing = true;
    // Wait for any pending chat to finish before exiting
    if (pendingChat) {
      await pendingChat;
    }
    console.log(`\n${dim('Bye!')}`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
