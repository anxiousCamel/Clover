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
import { randomUUID } from 'node:crypto';
import * as sessionManager from './session.manager.js';
import * as memoryService from '../memory/memory.service.js';
import * as agentEngine from '../agents/agent-engine.js';
import type { DispatchOptions, DispatchResult, EmitFn } from '../agents/agent-engine.js';
import * as toolRegistry from '../tools/tool-registry.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import type { SubagentContext } from './subagent-context.js';
import { resetDepth, decrementDepth } from '../tools/plugins/spawn-subagent.tool.js';
import { telemetryBus } from '../telemetry/telemetry.bus.js';

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
// Active subagent tracking
// ---------------------------------------------------------------------------

/**
 * Module-level map tracking active subagent contexts keyed by subagent ID.
 * Entries are added on spawn and removed on completion or failure.
 */
const activeSubagents = new Map<string, SubagentContext>();

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

  // ── 0. Generate traceId for telemetry correlation ───────
  const traceId = randomUUID();

  // ── 0b. Reset subagent depth for new top-level messages ─
  resetDepth(sessionId);

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
  const contextMessages = await sessionManager.buildContextWindow(
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
    traceId,
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
// Subagent execution
// ---------------------------------------------------------------------------

/**
 * Execute a subagent through the full pipeline.
 *
 * The subagent runs the same dispatch cycle as a normal user message but
 * with its own isolated chat history and optional system prompt. The
 * parent agent awaits this call, so execution is sequential.
 *
 * On completion the subagent's status and result are updated in-place,
 * the depth counter is decremented, and the subagent is removed from
 * the active tracking map.
 *
 * @param subCtx  - The isolated subagent context created by the spawn tool.
 * @param options - Workspace path, emit callback, and optional abort signal.
 * @returns A {@link HandleResult} with the agent name, response text, and
 *          cancellation flag.
 */
export async function handleSubagent(
  subCtx: SubagentContext,
  options: HandleOptions,
): Promise<HandleResult> {
  const { workspacePath, emit, signal } = options;

  // Track the subagent
  activeSubagents.set(subCtx.id, subCtx);

  try {
    // Build messages: optional system prompt + the goal as a user message
    const messages: Message[] = [];

    if (subCtx.systemPrompt) {
      messages.push({ role: 'system', content: subCtx.systemPrompt });
    } else {
      messages.push({ role: 'system', content: DEFAULT_SYSTEM_PROMPT });
    }

    // Include any existing chat history (for multi-turn subagent conversations)
    messages.push(...subCtx.chatHistory);

    // The goal becomes the user message
    const goalMsg: Message = { role: 'user', content: subCtx.goal };
    messages.push(goalMsg);

    // Gather the same tool set available to the parent
    const tools = buildToolList();

    const request: CompletionRequest = {
      messages,
      tools,
      stream: true,
    };

    // Dispatch through the agent engine (same pipeline as a normal message)
    const dispatchOptions: DispatchOptions = {
      workspacePath,
      emit,
      signal,
    };

    const result: DispatchResult = await agentEngine.dispatch(
      request,
      subCtx.parentSessionId,
      dispatchOptions,
    );

    // Update the subagent context with the result
    subCtx.status = result.cancelled ? 'failed' : 'completed';
    subCtx.result = result.text;

    // Persist the goal and response in the subagent's own chat history
    subCtx.chatHistory.push(goalMsg);
    if (result.text) {
      subCtx.chatHistory.push({ role: 'assistant', content: result.text });
    }

    // ── Emit UI visibility events on completion ───────────
    if (result.cancelled) {
      emit('subagent:failed', {
        subagentId: subCtx.id,
        parentSessionId: subCtx.parentSessionId,
        goal: subCtx.goal,
        error: 'Subagent execution was cancelled',
        depth: subCtx.depth,
      });
      emit('subagent:status', {
        subagentId: subCtx.id,
        status: 'failed',
        depth: subCtx.depth,
      });
    } else {
      emit('subagent:complete', {
        subagentId: subCtx.id,
        parentSessionId: subCtx.parentSessionId,
        goal: subCtx.goal,
        result: result.text,
        depth: subCtx.depth,
      });
      emit('subagent:status', {
        subagentId: subCtx.id,
        status: 'completed',
        depth: subCtx.depth,
      });
    }

    return {
      agent: result.agent,
      text: result.text,
      cancelled: result.cancelled,
    };
  } catch (error: unknown) {
    // Mark the subagent as failed
    subCtx.status = 'failed';
    subCtx.result =
      error instanceof Error ? error.message : 'Subagent execution failed';

    // ── Emit UI visibility events on failure ──────────────
    const errorMessage =
      error instanceof Error ? error.message : 'Subagent execution failed';

    emit('subagent:failed', {
      subagentId: subCtx.id,
      parentSessionId: subCtx.parentSessionId,
      goal: subCtx.goal,
      error: errorMessage,
      depth: subCtx.depth,
    });
    emit('subagent:status', {
      subagentId: subCtx.id,
      status: 'failed',
      depth: subCtx.depth,
    });

    throw error;
  } finally {
    // Decrement the depth counter so the session can spawn again at this level
    decrementDepth(subCtx.parentSessionId);

    // Remove from active tracking
    activeSubagents.delete(subCtx.id);
  }
}

/**
 * Return the active subagent context for a given subagent ID, or undefined.
 */
export function getActiveSubagent(subagentId: string): SubagentContext | undefined {
  return activeSubagents.get(subagentId);
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

    const schema = zodToJsonSchema(plugin.inputSchema as z.ZodSchema) as any;
    delete schema.$schema;
    
    tools.push({
      name: plugin.name,
      description: plugin.description,
      inputSchema: schema,
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
