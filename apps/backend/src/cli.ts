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
import { config } from './config/config.js';
import { SQLiteStore } from './storage/sqlite.store.js';
import * as lancedb from './memory/lancedb.adapter.js';
import * as sessionManager from './orchestrator/session.manager.js';
import * as toolRegistry from './tools/tool-registry.js';
import * as agentEngine from './agents/agent-engine.js';
import * as ollamaClient from './ollama/ollama.client.js';
import * as memoryService from './memory/memory.service.js';

// ---------------------------------------------------------------------------
// Colors (ANSI)
// ---------------------------------------------------------------------------

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<{ sessionId: string }> {
  console.log(`${CYAN}${BOLD}🍀 Clover CLI${RESET}`);
  console.log(`${DIM}Booting...${RESET}\n`);

  // SQLite
  const store = new SQLiteStore('./data/clover.db');
  await store.ensureReady();

  // LanceDB
  try {
    await lancedb.init(config.memory.dbPath);
  } catch {
    console.log(`${DIM}LanceDB init skipped (non-critical)${RESET}`);
  }

  // Session manager
  sessionManager.init(store);

  // Tools
  await toolRegistry.loadPlugins();
  console.log(`${DIM}Tools: ${toolRegistry.listTools().length} plugins${RESET}`);

  // Agents
  await agentEngine.loadAgents();
  console.log(`${DIM}Agents: ${agentEngine.listAgents().length} loaded${RESET}`);

  // Check Ollama
  try {
    const models = await ollamaClient.listModels();
    console.log(`${DIM}Ollama: ${models.length} model(s) available${RESET}`);
  } catch {
    console.log(`${DIM}⚠ Ollama not reachable at ${config.ollama.host}${RESET}`);
  }

  // Create session
  const session = sessionManager.createSession(process.cwd());
  console.log(`${DIM}Session: ${session.id.slice(0, 8)}...${RESET}`);
  console.log();

  return { sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Chat loop
// ---------------------------------------------------------------------------

async function chat(sessionId: string, userMessage: string): Promise<string> {
  // Load history
  const history = sessionManager.loadHistory(sessionId);

  // RAG search (best-effort)
  let memoryChunks: Awaited<ReturnType<typeof memoryService.search>> = [];
  try {
    memoryChunks = await memoryService.search(userMessage, 5);
  } catch {
    // skip
  }

  // Build context
  const contextMessages = sessionManager.buildContextWindow(
    sessionId,
    memoryChunks,
    'You are Clover, a helpful local AI assistant. Answer concisely.',
  );

  const messages = [...contextMessages, { role: 'user' as const, content: userMessage }];

  // Call Ollama directly
  const model = 'qwen2.5-coder:14b';
  const response = await ollamaClient.chat(messages, model);

  // Save to history
  sessionManager.saveMessage(sessionId, { role: 'user', content: userMessage });
  if (response) {
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
    prompt: `${GREEN}you › ${RESET}`,
  });

  console.log(`${DIM}Type your message. Ctrl+C to exit.${RESET}\n`);
  rl.prompt();

  let pendingChat: Promise<void> | null = null;

  rl.on('line', (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === '/quit' || input === '/exit') {
      console.log(`\n${DIM}Bye!${RESET}`);
      process.exit(0);
    }

    if (input === '/history') {
      const history = sessionManager.loadHistory(sessionId);
      for (const msg of history) {
        const prefix = msg.role === 'user' ? `${GREEN}you${RESET}` : `${CYAN}clover${RESET}`;
        console.log(`${prefix}: ${msg.content.slice(0, 120)}`);
      }
      console.log();
      rl.prompt();
      return;
    }

    // Pause readline while waiting for response
    rl.pause();
    process.stdout.write(`${CYAN}clover › ${RESET}`);

    pendingChat = (async () => {
      try {
        const response = await chat(sessionId, input);
        console.log(response);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\x1b[31mError: ${msg}${RESET}`);
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
    console.log(`\n${DIM}Bye!${RESET}`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
