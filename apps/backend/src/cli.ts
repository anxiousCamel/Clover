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

async function chat(sessionId: string, userMessage: string, rl: readline.Interface): Promise<string> {
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
      function: {
        name: plugin.name,
        description: plugin.description,
        parameters: schema,
      },
    };
  });

  let isStatusActive = false;
  const toolResults: Array<{tool: string, success: boolean, output: string}> = [];

  // Dispatch to agent engine
  const result = await agentEngine.dispatch(
    {
      messages,
      tools: availableTools,
      model: 'qwen2.5-coder:14b',
    },
    sessionId,
    {
      workspacePath,
      onConfirmationRequired: async (toolName, args: any) => {
        isStatusActive = false;
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);

        console.log(`\n${chalk.yellow('⚠️  Confirmation Required')}`);
        console.log(`${dim('Clover wants to use:')} ${chalk.cyan(toolName)}`);

        // Humanize arguments
        if (toolName === 'write-file' || toolName === 'edit-file' || toolName === 'read-file' || toolName === 'list-files') {
          const target = args.path || args.directory || '.';
          console.log(`${dim('Target:')} ${highlight(target)}`);
          if (args.content) {
            const preview = args.content.length > 100
              ? args.content.slice(0, 100).replace(/\n/g, ' ') + '...'
              : args.content.replace(/\n/g, ' ');
            console.log(`${dim('Content:')} ${preview}`);
          }
        } else if (toolName === 'execute-command') {
          console.log(`${dim('Command:')} ${chalk.magenta(args.command)}`);
        } else {
          console.log(`${dim('Arguments:')} ${JSON.stringify(args, null, 2)}`);
        }

        console.log(`\n  1. ${chalk.red('no')}  2. ${chalk.green('allow')}  3. ${chalk.blue('other')}\n`);

        return new Promise((resolve) => {
          rl.resume();
          rl.question(chalk.yellow('Selection (1/2/3): '), (answer) => {
            rl.pause();
            const choice = answer.trim().toLowerCase();
            const affirmative = ['2', 'allow', 'y', 'yes', 'sim', 's', 'ok', 'pode', 'bora'];
            if (affirmative.includes(choice)) {
              resolve(true);
            } else {
              resolve(false);
            }
          });
        });
      },
      emit: (type, data: any) => {
        if (type === 'message:token') {
          if (isStatusActive && data.token) {
            readline.cursorTo(process.stdout, 0);
            readline.clearLine(process.stdout, 0);
            process.stdout.write(chalk.cyan('clover › '));
            isStatusActive = false;
          }
          process.stdout.write(data.token);
        } else if (type === 'tool:executing') {
          isStatusActive = true;
          readline.cursorTo(process.stdout, 0);
          readline.clearLine(process.stdout, 0);
          process.stdout.write(`${chalk.cyan('clover › ')}${dim(data.toolName + '...')}`);
        } else if (type === 'tool:result') {
          // Track tool results for history persistence
          toolResults.push({
            tool: data.toolName || 'unknown',
            success: !!data.success,
            output: data.output || data.error || '',
          });

          if (data.success) {
            // Clear the "toolName..." status and show brief success
            readline.cursorTo(process.stdout, 0);
            readline.clearLine(process.stdout, 0);
            isStatusActive = false;
          } else {
            isStatusActive = false;
            readline.cursorTo(process.stdout, 0);
            readline.clearLine(process.stdout, 0);
            const errorMsg = data.error || data.output || `Tool "${data.toolName}" failed with no error details`;
            process.stdout.write(`  ${chalk.red('✗')} ${dim(errorMsg)}\n`);
          }
        } else if (type === 'agent:status' && data.status === 'running') {
          isStatusActive = true;
          readline.cursorTo(process.stdout, 0);
          readline.clearLine(process.stdout, 0);
          process.stdout.write(`${chalk.cyan('clover › ')}${dim('pensando...')}`);
        }
      },
    }
  );

  const response = result.text;

  // If the response came from the pipeline (direct execution), it wasn't streamed.
  // We need to print it now.
  if (result.agent === 'pipeline' && response) {
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(chalk.cyan('clover › '));
    console.log(response);
  }

  // Save to history — include tool results so model remembers what it did
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

  console.log(dim('Type your message. Ctrl+C to exit.\n'));
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

    // Pause readline while waiting for response
    rl.pause();

    pendingChat = (async () => {
      try {
        await chat(sessionId, input, rl);
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
