/**
 * Agent Engine — discovers agents, routes user messages by intent, manages
 * the agent lifecycle (streaming, tool-call interception, cancellation),
 * and emits status events.
 *
 * The engine auto-discovers `*.agent.ts` (or compiled `*.agent.js`) files
 * in this directory, registers them in priority order, and dispatches
 * incoming requests to the first agent whose `matchesIntent` returns true.
 *
 * During a dispatch the engine consumes the gRPC streaming response from
 * OpenClaude, intercepts `tool_call` chunks, enforces the agent's
 * `allowedTools` allowlist, and routes valid calls through the Tool Registry.
 *
 * @module agents/agent-engine
 */

import { glob } from 'glob';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  Agent,
  AgentContext,
  AgentStatus,
  CompletionRequest,
  CompletionChunk,
  Message,
  ToolResult,
} from '@clover/shared';
import { streamComplete } from '../openclaude/openclaude.client.js';
import * as ollamaClient from '../ollama/ollama.client.js';
import * as toolRegistry from '../tools/tool-registry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback used to emit WebSocket events to the client. */
export type EmitFn = (type: string, data: unknown) => void;

/** Options accepted by {@link dispatch}. */
export interface DispatchOptions {
  /** Workspace root path for tool execution context. */
  workspacePath: string;
  /** Callback to emit WebSocket events (agent:status, message:token, etc.). */
  emit: EmitFn;
  /** Optional AbortController — calling `.abort()` cancels the active gRPC stream. */
  signal?: AbortSignal;
}

/** Result returned by {@link dispatch}. */
export interface DispatchResult {
  /** Name of the agent that handled the request. */
  agent: string;
  /** Concatenated assistant text produced during the stream. */
  text: string;
  /** Whether the dispatch was cancelled via AbortController. */
  cancelled: boolean;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/** Thrown when a tool call is not in the active agent's allowedTools list. */
export class ToolNotAllowedError extends Error {
  constructor(toolName: string, agentName: string) {
    super(
      `Agent "${agentName}" is not allowed to use tool "${toolName}". ` +
        `Allowed tools: check the agent definition.`,
    );
    this.name = 'ToolNotAllowedError';
  }
}

/** Thrown when no agent matches the user's intent. */
export class NoMatchingAgentError extends Error {
  constructor() {
    super('No agent matched the user intent.');
    this.name = 'NoMatchingAgentError';
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Agents registered in priority order (index 0 = highest priority).
 * Priority is determined by insertion order — register higher-priority
 * agents first.
 */
const agents: Agent[] = [];

/**
 * Map of active AbortControllers keyed by sessionId so that in-flight
 * dispatches can be cancelled externally.
 */
const activeControllers = new Map<string, AbortController>();

// ---------------------------------------------------------------------------
// Agent loading & registration
// ---------------------------------------------------------------------------

/**
 * Auto-discover all `*.agent.ts` (or compiled `*.agent.js`) files in the
 * agents directory (same directory as this file) and register them.
 *
 * Each module must default-export an {@link Agent} object.  The engine
 * skips `agent-engine` itself to avoid circular self-registration.
 */
export async function loadAgents(): Promise<void> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const pattern = path.join(currentDir, '*.agent.{ts,js}');
  const files = await glob(pattern, { windowsPathsNoEscape: true });

  // Collect agents, then register specialised ones first, catch-all last
  const specialised: Agent[] = [];
  let catchAll: Agent | undefined;

  for (const file of files) {
    // Skip the engine file itself
    const basename = path.basename(file);
    if (basename.startsWith('agent-engine')) continue;

    const mod: Record<string, unknown> = await import(pathToFileURL(file).href);
    const agent = (mod['default'] ?? mod['agent']) as Agent | undefined;

    if (agent && typeof agent.name === 'string') {
      if (agent.name === 'general') {
        catchAll = agent;
      } else {
        specialised.push(agent);
      }
    }
  }

  for (const agent of specialised) {
    registerAgent(agent);
  }
  if (catchAll) {
    registerAgent(catchAll);
  }
}

/**
 * Register a single agent. Supports one-line registration for new agents:
 *
 * ```ts
 * import { registerAgent } from './agent-engine.js';
 * registerAgent(myCustomAgent);
 * ```
 *
 * Duplicate names are silently replaced so hot-reload scenarios work.
 */
export function registerAgent(agent: Agent): void {
  const idx = agents.findIndex((a) => a.name === agent.name);
  if (idx !== -1) {
    agents[idx] = agent;
  } else {
    agents.push(agent);
  }
}

/**
 * Return a read-only snapshot of registered agent names in priority order.
 */
export function listAgents(): string[] {
  return agents.map((a) => a.name);
}

/**
 * Return the agent instance for a given name, or undefined.
 */
export function getAgent(name: string): Agent | undefined {
  return agents.find((a) => a.name === name);
}

// ---------------------------------------------------------------------------
// Intent matching
// ---------------------------------------------------------------------------

/**
 * Evaluate each registered agent's `matchesIntent` in priority order and
 * return the first match, or `undefined` if none match.
 */
export function matchIntent(
  message: string,
  context?: AgentContext,
): Agent | undefined {
  return agents.find((a) => a.matchesIntent(message, context));
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/**
 * Cancel the active dispatch for a given session.  If no dispatch is
 * running for the session this is a no-op.
 */
export function cancel(sessionId: string): void {
  const controller = activeControllers.get(sessionId);
  if (controller) {
    controller.abort();
    activeControllers.delete(sessionId);
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a completion request to the first agent that matches the user
 * intent.
 *
 * The dispatch:
 * 1. Selects an agent via {@link matchIntent}.
 * 2. Emits `agent:status` → `running`.
 * 3. Streams the completion from OpenClaude.
 * 4. Intercepts `tool_call` chunks, enforces the allowlist, and executes
 *    tools via the Tool Registry.
 * 5. Emits `agent:status` → `done` (or `error`).
 *
 * @returns A {@link DispatchResult} with the agent name, accumulated text,
 *          and cancellation flag.
 */
export async function dispatch(
  request: CompletionRequest,
  sessionId: string,
  options: DispatchOptions,
): Promise<DispatchResult> {
  const { workspacePath, emit, signal } = options;

  // --- Extract user message for intent matching ---
  const userMessage = extractUserMessage(request);

  const agentContext: AgentContext = {
    sessionId,
    workspacePath,
  };

  const agent = matchIntent(userMessage, agentContext);
  if (!agent) {
    throw new NoMatchingAgentError();
  }

  // --- Set up cancellation ---
  const controller = new AbortController();
  activeControllers.set(sessionId, controller);

  // If an external signal is provided, wire it to our internal controller
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  // --- Emit running status ---
  emitStatus(emit, agent.name, 'running');

  let text = '';
  let cancelled = false;

  try {
    // Inject the agent's system prompt into the request
    const agentRequest = injectSystemPrompt(request, agent);

    // Try OpenClaude gRPC first, fall back to Ollama if unavailable
    let useOllamaFallback = false;
    try {
      const stream = streamComplete(agentRequest);

      let turnCount = 0;

      for await (const chunk of stream) {
        // Check cancellation
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }

        if (chunk.type === 'token' && chunk.token) {
          text += chunk.token;
          emit('message:token', { sessionId, token: chunk.token });
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          const toolResult = await handleToolCall(
            chunk.toolCall.name,
            chunk.toolCall.arguments,
            agent,
            { workspacePath, sessionId, emit },
          );

          // Emit tool result event
          emit('tool:result', {
            toolName: chunk.toolCall.name,
            success: toolResult.success,
            output: toolResult.output,
          });

          turnCount++;
          if (turnCount >= agent.maxTurns) {
            break;
          }
        } else if (chunk.type === 'usage' && chunk.usage) {
          emit('message:done', { sessionId, usage: chunk.usage });
        }
      }
    } catch (grpcErr) {
      // OpenClaude unavailable — fall back to Ollama
      console.log(`[agent-engine] OpenClaude unavailable, falling back to Ollama: ${(grpcErr as Error).message}`);
      useOllamaFallback = true;
    }

    // --- Ollama fallback (no tool calls, simple chat) ---
    if (useOllamaFallback && !cancelled) {
      const model = agentRequest.model || 'qwen2.5-coder:14b';
      // Strip messages to only role+content (Ollama format)
      const ollamaMessages = agentRequest.messages.map(m => ({
        role: m.role,
        content: m.content,
      }));
      console.log(`[agent-engine] Calling Ollama with model=${model}, messages=${ollamaMessages.length}`);
      try {
        text = await ollamaClient.chat(ollamaMessages, model);
        console.log(`[agent-engine] Ollama responded: ${text.length} chars`);
      } catch (ollamaErr) {
        console.error(`[agent-engine] Ollama fallback failed:`, (ollamaErr as Error).message);
        throw ollamaErr;
      }

      // Emit all tokens at once (Ollama non-streaming)
      if (text) {
        emit('message:token', { sessionId, token: text });
      }
      emit('message:done', { sessionId, usage: { inputTokens: 0, outputTokens: 0 } });
    }

    // --- Emit done status ---
    emitStatus(emit, agent.name, 'done', cancelled ? 'cancelled' : undefined);
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : 'Unknown error';
    emitStatus(emit, agent.name, 'error', detail);
    throw error;
  } finally {
    activeControllers.delete(sessionId);
  }

  return { agent: agent.name, text, cancelled };
}

// ---------------------------------------------------------------------------
// Tool call handling (private)
// ---------------------------------------------------------------------------

/**
 * Handle a tool call from the gRPC stream:
 * 1. Enforce the agent's allowedTools allowlist.
 * 2. Parse the tool arguments.
 * 3. Execute via the Tool Registry.
 */
async function handleToolCall(
  toolName: string,
  rawArgs: string,
  agent: Agent,
  ctx: { workspacePath: string; sessionId: string; emit: EmitFn },
): Promise<ToolResult> {
  // --- Enforce allowlist ---
  if (!agent.allowedTools.includes(toolName)) {
    const error = new ToolNotAllowedError(toolName, agent.name);
    return {
      success: false,
      output: '',
      error: error.message,
    };
  }

  // --- Emit executing event ---
  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(rawArgs);
  } catch {
    return {
      success: false,
      output: '',
      error: `Failed to parse tool arguments for "${toolName}": invalid JSON`,
    };
  }

  ctx.emit('tool:executing', { toolName, args: parsedArgs });

  // --- Execute via Tool Registry ---
  try {
    const result = await toolRegistry.execute(toolName, parsedArgs, {
      workspacePath: ctx.workspacePath,
      sessionId: ctx.sessionId,
      execGuard: {} as import('@clover/shared').ExecGuard, // injected at orchestrator level
      emitEvent: ctx.emit,
    });
    return result;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Tool execution failed';
    return {
      success: false,
      output: '',
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

/**
 * Extract the last user message from a CompletionRequest for intent matching.
 */
function extractUserMessage(request: CompletionRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    if (request.messages[i].role === 'user') {
      return request.messages[i].content;
    }
  }
  return '';
}

/**
 * Inject the agent's system prompt as the first message in the request.
 * If a system message already exists it is replaced.
 */
function injectSystemPrompt(
  request: CompletionRequest,
  agent: Agent,
): CompletionRequest {
  const messages: Message[] = [
    { role: 'system', content: agent.systemPrompt },
    ...request.messages.filter((m) => m.role !== 'system'),
  ];

  // Filter tools to only those in the agent's allowlist
  const tools = request.tools?.filter((t) =>
    agent.allowedTools.includes(t.name),
  );

  return { ...request, messages, tools };
}

/**
 * Emit an `agent:status` WebSocket event.
 */
function emitStatus(
  emit: EmitFn,
  agentName: string,
  status: AgentStatus,
  detail?: string,
): void {
  emit('agent:status', { agent: agentName, status, detail });
}
