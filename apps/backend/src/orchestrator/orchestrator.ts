/**
 * Orchestrator — central coordinator that ties together session management,
 * RAG memory retrieval, agent dispatch, and turn persistence.
 *
 * The orchestrator is the single entry point for handling user messages.
 * It assembles the full context window (system prompt, memory chunks,
 * conversation history, user message, tool list), dispatches to the
 * Agent Engine, and persists the completed turn to both SQLite (history)
 * and LanceDB (vector memory).
 *
 * @module orchestrator/orchestrator
 */

import type { CompletionRequest, Message, Tool } from '@clover/shared';
import * as sessionManager from './session.manager.js';
import * as memoryService from '../memory/memory.service.js';
import * as agentEngine from '../agents/agent-engine.js';
import type { DispatchOptions, DispatchResult, EmitFn } from '../agents/agent-engine.js';
import * as toolRegistry from '../tools/tool-registry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the orchestrator handle call. */
export interface HandleOptions {
  /** Absolute path to the user's workspace directory. */
  workspacePath: string;
  /** Callback to emit WebSocket events to the client. */
  emit: EmitFn;
  /** Optional AbortSignal for cancellation support. */
  signal?: AbortSignal;
}

/** Result returned by {@link handle}. */
export interface HandleResult {
  /** Name of the agent that handled the request. */
  agent: string;
  /** The assistant's response text. */
  text: string;
  /** Whether the request was cancelled. */
  cancelled: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default system prompt used when no agent-specific prompt overrides it. */
const DEFAULT_SYSTEM_PROMPT =
  'You are Clover, a helpful local AI assistant. ' +
  'Answer the user concisely and accurately. ' +
  'Use the available tools when needed to accomplish tasks.';

/** Default number of memory chunks to retrieve for RAG. */
const DEFAULT_TOP_K = 5;

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Handle an incoming user message for a given session.
 *
 * This is the main entry point called by the Gateway when a chat message
 * arrives. The flow is:
 *
 * 1. Load conversation history from SQLite via Session Manager.
 * 2. Perform RAG retrieval — search LanceDB for relevant memory chunks.
 * 3. Build a {@link CompletionRequest} with system prompt, memory context,
 *    history, user message, and the full tool list.
 * 4. Dispatch to the Agent Engine which selects an agent and streams the
 *    completion from OpenClaude.
 * 5. Save the user message and assistant response to SQLite.
 * 6. Index the turn text into LanceDB for future RAG retrieval.
 *
 * @param sessionId   - The session UUID.
 * @param userMessage - The raw text message from the user.
 * @param options     - Workspace path, emit callback, and optional abort signal.
 * @returns A {@link HandleResult} with the agent name, response text, and
 *          cancellation flag.
 */
export async function handle(
  sessionId: string,
  userMessage: string,
  options: HandleOptions,
): Promise<HandleResult> {
  const { workspacePath, emit, signal } = options;

  // ── 1. Load conversation history ────────────────────────
  const history = sessionManager.loadHistory(sessionId);

  // ── 2. RAG retrieval — search memory for relevant chunks ─
  let memoryChunks: Awaited<ReturnType<typeof memoryService.search>> = [];
  try {
    memoryChunks = await memoryService.search(userMessage, DEFAULT_TOP_K);
  } catch {
    // Memory search is best-effort — empty LanceDB or embedder issues
    // should not block the chat flow
  }

  // ── 3. Build CompletionRequest ──────────────────────────
  const contextMessages = sessionManager.buildContextWindow(
    sessionId,
    memoryChunks,
    DEFAULT_SYSTEM_PROMPT,
  );

  // Append the current user message as the last message
  const userMsg: Message = { role: 'user', content: userMessage };
  const messages: Message[] = [...contextMessages, userMsg];

  // Gather available tools from the Tool Registry
  const tools = buildToolList();

  // Get the model selected for this session (or default)
  const selectedModel = sessionManager.getModel(sessionId);

  const request: CompletionRequest = {
    messages,
    tools,
    stream: true,
    model: selectedModel ?? undefined,
  };

  // ── 4. Dispatch to Agent Engine ─────────────────────────
  const dispatchOptions: DispatchOptions = {
    workspacePath,
    emit,
    signal,
  };

  const result: DispatchResult = await agentEngine.dispatch(
    request,
    sessionId,
    dispatchOptions,
  );

  // ── 5. Save completed turn to SQLite ────────────────────
  sessionManager.saveMessage(sessionId, userMsg);

  if (result.text) {
    const assistantMsg: Message = {
      role: 'assistant',
      content: result.text,
    };
    sessionManager.saveMessage(sessionId, assistantMsg);
  }

  // ── 6. Index turn text to LanceDB for future RAG ────────
  await indexTurn(sessionId, userMessage, result.text);

  return {
    agent: result.agent,
    text: result.text,
    cancelled: result.cancelled,
  };
}

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

/**
 * Build the tool list from the Tool Registry for inclusion in the
 * CompletionRequest.
 *
 * Maps registered tool plugin names to {@link Tool} objects with name,
 * description, and input schema. Only tools that have a registered plugin
 * with full metadata are included.
 */
function buildToolList(): Tool[] {
  const toolNames = toolRegistry.listTools();
  const tools: Tool[] = [];

  for (const name of toolNames) {
    const plugin = toolRegistry.getPlugin(name);
    if (!plugin) continue;

    tools.push({
      name: plugin.name,
      description: plugin.description,
      inputSchema: plugin.inputSchema as Record<string, unknown>,
    });
  }

  return tools;
}

/**
 * Index the user message and assistant response into LanceDB so they
 * become available for future RAG retrieval.
 *
 * Failures are logged but do not propagate — indexing is best-effort
 * and should never block the response flow.
 */
async function indexTurn(
  sessionId: string,
  userMessage: string,
  assistantText: string,
): Promise<void> {
  try {
    const turnText = `User: ${userMessage}\nAssistant: ${assistantText}`;
    await memoryService.indexText(turnText, { source: 'conversation' });
  } catch {
    // Indexing is best-effort — log but don't propagate
    // In production this would go to a structured logger
  }
}
