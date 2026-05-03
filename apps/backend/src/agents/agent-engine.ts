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
import { existsSync } from 'node:fs';
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
import * as taskService from '../orchestrator/task.service.js';
import { runPipeline, updateContext } from '../pipeline/index.js';
import { telemetryBus } from '../telemetry/telemetry.bus.js';

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
  /** Callback to request user approval for destructive tools. */
  onConfirmationRequired: (toolName: string, args: unknown) => Promise<boolean>;
  /** Optional AbortController — calling `.abort()` cancels the active gRPC stream. */
  signal?: AbortSignal;
  /** Trace ID for telemetry correlation. Generated per user message by the Orchestrator. */
  traceId?: string;
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
  const pattern = path.join(currentDir, '**/*.agent.{ts,js}');
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
      if (agent.isFallback) {
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
  // Try specialized agents first (those with a matchesIntent function)
  const specializedMatch = agents.find((a) => a.matchesIntent?.(message, context));
  if (specializedMatch) return specializedMatch;

  // Fallback to the first agent marked as fallback
  return agents.find((a) => a.isFallback);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sync operational context after a tool call. */
function syncContext(sessionId: string, toolName: string, toolArgs: any, success: boolean): void {
  if (!success) return;
  
  const updates: any = { lastIntent: toolName as any };
  if (toolArgs.path && typeof toolArgs.path === 'string') {
    updates.lastFilePath = toolArgs.path;
  }
  if (toolArgs.content && typeof toolArgs.content === 'string') {
    updates.lastGeneratedContent = toolArgs.content;
  }
  updateContext(sessionId, updates);
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
 * Dispatch a user request to the most appropriate agent and manage the turn-based
 * autonomous tool execution loop.
 */
export async function dispatch(
  request: CompletionRequest,
  sessionId: string,
  options: DispatchOptions,
): Promise<DispatchResult> {
  const { workspacePath, emit, onConfirmationRequired, signal } = options;

  // --- Extract user message for intent matching ---
  const userMessage = extractUserMessage(request);

  // ---------------------------------------------------------------------------
  // PIPELINE — deterministic intent classification + forced tool execution
  // ---------------------------------------------------------------------------
  // Runs BEFORE agent routing. If the pipeline decides to execute a tool,
  // we skip the LLM turn entirely and return immediately.
  // ---------------------------------------------------------------------------
  try {
    const pipelineDecision = await runPipeline({
      input: userMessage,
      sessionId,
      workspacePath,
      model: request.model || 'qwen2.5-coder:14b',
      traceId: options.traceId,
    });

    if (pipelineDecision.mode === 'execute' && pipelineDecision.toolName && pipelineDecision.toolArgs) {
      const { toolName, toolArgs } = pipelineDecision;

      emitStatus(emit, 'pipeline', 'running');
      emit('tool:executing', { toolName, args: toolArgs });

      // Confirmation check
      const plugin = toolRegistry.getPlugin(toolName);
      if (plugin?.requiresConfirmation(toolArgs)) {
        const approved = await onConfirmationRequired(toolName, toolArgs);
        if (!approved) {
          emitStatus(emit, 'pipeline', 'done');
          return { agent: 'pipeline', text: 'Operação cancelada pelo usuário.', cancelled: false };
        }
      }

      // Execute tool directly (pipeline bypasses agent allowlist)
      const toolExecStart = Date.now();
      const toolResult = await executePipelineTool(toolName, toolArgs, workspacePath, sessionId, emit);
      const toolExecDuration = Date.now() - toolExecStart;

      // Emit tool execution telemetry
      if (options.traceId) {
        telemetryBus.emitEvent({
          traceId: options.traceId,
          stage: 'tool',
          timestamp: toolExecStart,
          durationMs: toolExecDuration,
          status: toolResult.success ? 'success' : 'error',
          metadata: {
            toolName,
            resultStatus: toolResult.success ? 'success' : 'error',
            error: toolResult.error ?? undefined,
          },
        });
      }

      emit('tool:result', {
        toolName,
        success: toolResult.success,
        output: toolResult.output,
        error: toolResult.error,
      });

      // Update operational context so follow-ups work
      syncContext(sessionId, toolName, toolArgs, toolResult.success);

      updateContext(sessionId, { lastToolOutput: toolResult.output || toolResult.error });

      const responseText = toolResult.success
        ? toolResult.output || `Feito: ${toolName}`
        : `Erro ao executar ${toolName}: ${toolResult.error}`;

      emitStatus(emit, 'pipeline', 'done');
      emit('message:done', { sessionId, usage: { inputTokens: 0, outputTokens: 0 } });
      return { agent: 'pipeline', text: responseText, cancelled: false };
    }
    // mode='chat' → fall through to normal agent dispatch
  } catch (pipelineErr) {
    // Pipeline errors are non-fatal — log and fall through
    const errMsg = pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr);
    process.stderr.write(`\x1b[33m[pipeline] error: ${errMsg}\x1b[0m\n`);
  }
  // ---------------------------------------------------------------------------

  // --- Task Initialization ---
  let task = taskService.getActiveTask(sessionId);
  if (!task) {
    // If the message looks like a goal, start a new task
    const isGoal = userMessage.length > 20 || /pode|faz|cria|resolve|busca/i.test(userMessage);
    if (isGoal) {
      task = taskService.createTask(sessionId, userMessage);
    }
  }

  const agentContext: AgentContext = {
    sessionId,
    workspacePath,
    task,
  };

  let agent = matchIntent(userMessage, agentContext);
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
    let grpcLlmStart = Date.now();
    try {
      const stream = streamComplete(agentRequest);

      let turnCount = 0;
      grpcLlmStart = Date.now();
      let grpcFirstTokenMs: number | undefined;

      for await (const chunk of stream) {
        // Check cancellation
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }

        if (chunk.type === 'token' && chunk.token) {
          if (grpcFirstTokenMs === undefined) {
            grpcFirstTokenMs = Date.now() - grpcLlmStart;
          }
          text += chunk.token;
          emit('message:token', { sessionId, token: chunk.token });
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          const toolName = chunk.toolCall.name;
          
          // --- Auto-Escalation ---
          if (!agent.allowedTools.includes(toolName)) {
            const escalatedAgent = agents.find(a => a.allowedTools.includes(toolName));
            if (escalatedAgent) {
              emit('agent:status', { agent: escalatedAgent.name, status: 'running', detail: `Escalated from ${agent.name} to handle ${toolName}` });
              agent = escalatedAgent;
            }
          }

          // --- Budget Enforcement ---
          if (task && !taskService.recordAttempt(sessionId, task.id)) {
            return { agent: agent.name, text: text + '\n\n[Execution stopped: task budget exceeded]', cancelled: true };
          }

          // --- Task Step Tracking ---
          if (task) {
            taskService.updateStep(sessionId, task.id, toolName, 'running', `Executing ${toolName}...`);
          }

          const toolResult = await handleToolCall(
            toolName,
            typeof chunk.toolCall.arguments === 'string' ? chunk.toolCall.arguments : JSON.stringify(chunk.toolCall.arguments),
            agent,
            { workspacePath, sessionId, emit, onConfirmationRequired },
          );

          if (task) {
            taskService.updateStep(sessionId, task.id, toolName, toolResult.success ? 'completed' : 'failed', toolResult.output || toolResult.error);
          }

          // Emit tool result event
          emit('tool:result', {
            toolName: chunk.toolCall.name,
            success: toolResult.success,
            output: toolResult.output,
            error: toolResult.error,
          });

          // Update operational context
          syncContext(sessionId, chunk.toolCall.name, chunk.toolCall.arguments, toolResult.success);

          turnCount++;
          if (turnCount >= agent.maxTurns) {
            break;
          }
        } else if (chunk.type === 'usage' && chunk.usage) {
          // Emit LLM telemetry for the gRPC stream
          if (options.traceId) {
            const grpcLlmDuration = Date.now() - grpcLlmStart;
            telemetryBus.emitEvent({
              traceId: options.traceId,
              stage: 'llm',
              timestamp: grpcLlmStart,
              durationMs: grpcLlmDuration,
              status: 'success',
              metadata: {
                model: agentRequest.model ?? 'unknown',
                promptTokens: chunk.usage.inputTokens ?? 0,
                completionTokens: chunk.usage.outputTokens ?? 0,
                timeToFirstTokenMs: grpcFirstTokenMs,
                totalResponseMs: grpcLlmDuration,
                triggerStage: 'agent-loop',
              },
            });
          }
          emit('message:done', { sessionId, usage: chunk.usage });
        }
      }
    } catch (grpcErr) {
      // OpenClaude unavailable — fall back to Ollama
      // Emit LLM error telemetry
      if (options.traceId) {
        const grpcLlmDuration = Date.now() - grpcLlmStart;
        telemetryBus.emitEvent({
          traceId: options.traceId,
          stage: 'llm',
          timestamp: grpcLlmStart,
          durationMs: grpcLlmDuration,
          status: 'error',
          metadata: {
            model: agentRequest.model ?? 'unknown',
            promptTokens: 0,
            completionTokens: 0,
            totalResponseMs: grpcLlmDuration,
            triggerStage: 'agent-loop',
            errorType: grpcErr instanceof Error ? grpcErr.constructor.name : 'UnknownError',
            partialResponseLength: text.length,
          },
        });
      }
      useOllamaFallback = true;
    }

    // --- Ollama fallback (with tool calls) ---
    if (useOllamaFallback && !cancelled) {
      const model = agentRequest.model || 'qwen2.5-coder:14b';
      const ollamaMessages = [...agentRequest.messages];
      const ollamaTools = agentRequest.tools;

      let turnCount = 0;
      while (turnCount < agent.maxTurns && !cancelled) {
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }

        // Only stream when no tools are available (pure chat).
        // When tools are present, we must buffer to parse tool calls before showing content.
        const hasTools = ollamaTools && ollamaTools.length > 0;
        const llmStart = Date.now();
        let llmFirstTokenMs: number | undefined;
        const wrappedOnToken = hasTools ? undefined : (token: string) => {
          if (llmFirstTokenMs === undefined) {
            llmFirstTokenMs = Date.now() - llmStart;
          }
          emit('message:token', { sessionId, token });
        };
        const response = await ollamaClient.chat(
          ollamaMessages,
          model,
          ollamaTools,
          wrappedOnToken,
        );
        const llmDuration = Date.now() - llmStart;

        // Emit LLM telemetry
        if (options.traceId) {
          telemetryBus.emitEvent({
            traceId: options.traceId,
            stage: 'llm',
            timestamp: llmStart,
            durationMs: llmDuration,
            status: 'success',
            metadata: {
              model,
              promptTokens: 0,
              completionTokens: 0,
              timeToFirstTokenMs: llmFirstTokenMs,
              totalResponseMs: llmDuration,
              triggerStage: 'agent-loop',
            },
          });
        }

        // Handle tool calls
        let toolCalls = response.tool_calls || [];

        // Fallback: Parse from content if no native tool_calls
        let finalContent = response.content;
        if (toolCalls.length === 0) {
          // Find the outermost JSON block
          const firstBrace = response.content.indexOf('{');
          const lastBrace = response.content.lastIndexOf('}');
          
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const jsonStr = response.content.slice(firstBrace, lastBrace + 1);
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.name && (parsed.arguments || parsed.args)) {
                toolCalls = [{
                  function: {
                    name: parsed.name,
                    arguments: parsed.arguments || parsed.args
                  }
                }];
                // Remove the JSON part AND any surrounding markdown fences from what we show the user
                finalContent = (response.content.slice(0, firstBrace) + response.content.slice(lastBrace + 1))
                  .replace(/```json\s*/gi, '')
                  .replace(/```\s*/g, '')
                  .trim();
              } else if (parsed.message || parsed.response || parsed.text || parsed.answer) {
                // Accidental JSON response from the model
                finalContent = parsed.message || parsed.response || parsed.text || parsed.answer;
              }
            } catch {
              // JSON is malformed — check if it LOOKS like a tool call attempt and suppress it
              if (/"name"\s*:/.test(jsonStr) && /"arguments"\s*:/.test(jsonStr)) {
                finalContent = (response.content.slice(0, firstBrace) + response.content.slice(lastBrace + 1))
                  .replace(/```json\s*/gi, '')
                  .replace(/```\s*/g, '')
                  .trim();
              }
            }
          }
        }

        // Final cleanup: strip any remaining code fences and stray JSON-like artifacts
        if (finalContent) {
          finalContent = finalContent
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/g, '')
            .trim();
        }

        // Emit text to user (only if not already streamed and has actual content)
        if (finalContent) {
          text += finalContent;
          if (hasTools) {
            emit('message:token', { sessionId, token: finalContent });
          }
        }

        if (toolCalls.length > 0) {
          // Add assistant message with tool calls to history
          const assistantMsg = {
            role: 'assistant',
            content: response.content,
            tool_calls: toolCalls.map((tc: any, i: number) => ({
              id: tc.id || `call_${Date.now()}_${i}`,
              type: 'function',
              function: tc.function,
            })),
          };
          ollamaMessages.push(assistantMsg as any);

          for (const call of (assistantMsg.tool_calls as any)) {
            const toolResult = await handleToolCall(
              call.function.name,
              typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments),
              agent,
              { workspacePath, sessionId, emit, onConfirmationRequired },
            );

            // Add tool result to history
            ollamaMessages.push({
              role: 'tool',
              content: toolResult.output || toolResult.error || 'Done',
              tool_call_id: call.id,
            } as any);

            // Emit tool result event
            emit('tool:result', {
              toolName: call.function.name,
              success: toolResult.success,
              output: toolResult.output,
              error: toolResult.error,
            });

            // Update operational context
            syncContext(sessionId, call.function.name, call.function.arguments, toolResult.success);
          }
          turnCount++;
        } else {
          // No more tool calls
          break;
        }
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

  if (task) {
    await taskService.verifySuccess(sessionId, task.id);
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
  ctx: { workspacePath: string; sessionId: string; emit: EmitFn; onConfirmationRequired: (toolName: string, args: unknown) => Promise<boolean> },
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

  // --- Check for confirmation ---
  const plugin = toolRegistry.getPlugin(toolName);
  if (plugin && plugin.requiresConfirmation(parsedArgs)) {
    const confirmed = await ctx.onConfirmationRequired(toolName, parsedArgs);
    if (!confirmed) {
      return {
        success: false,
        output: '',
        error: 'Tool execution denied by user.',
      };
    }
  }

  ctx.emit('tool:executing', { toolName, args: parsedArgs });

  // --- Execute via Tool Registry (bypass confirmation since we already handled it) ---
  try {
    const plugin = toolRegistry.getPlugin(toolName);
    if (!plugin) {
      return {
        success: false,
        output: '',
        error: `Tool "${toolName}" not found`,
      };
    }

    // Validate args with Zod
    const { z } = await import('zod');
    const schema = plugin.inputSchema;
    let validatedArgs = parsedArgs;
    if (schema instanceof z.ZodType) {
      const parseResult = schema.safeParse(parsedArgs);
      if (!parseResult.success) {
        return {
          success: false,
          output: '',
          error: `Validation failed for "${toolName}": ${parseResult.error.issues.map(i => i.message).join(', ')}`,
        };
      }
      validatedArgs = parseResult.data;
    }

    // Execute directly (skip toolRegistry.execute to avoid double confirmation)
    const result = await plugin.execute(validatedArgs, {
      workspacePath: ctx.workspacePath,
      sessionId: ctx.sessionId,
      execGuard: {} as import('@clover/shared').ExecGuard,
      emitEvent: ctx.emit,
    });

    // --- Post-Condition Check ---
    if (result.success) {
      if (toolName === 'write-file' || toolName === 'edit-file') {
        const filePath = (validatedArgs as any).path;
        if (filePath && !existsSync(path.resolve(ctx.workspacePath, filePath))) {
          result.success = false;
          result.error = `Post-condition failed: File "${filePath}" was not created or found after write-file.`;
        }
      }
    }

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
  const tools = request.tools?.filter((t) => {
    const name = (t as any).function?.name || t.name;
    return agent.allowedTools.includes(name);
  });

  return { 
    ...request, 
    messages, 
    tools: tools && tools.length > 0 ? tools : undefined 
  };
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

// ---------------------------------------------------------------------------
// Pipeline tool executor (private)
// ---------------------------------------------------------------------------

/**
 * Execute a tool directly via the plugin registry, bypassing agent allowlists.
 * Used exclusively by the pipeline's forced-execution path.
 */
async function executePipelineTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  workspacePath: string,
  sessionId: string,
  emit: EmitFn,
): Promise<ToolResult> {
  const plugin = toolRegistry.getPlugin(toolName);
  if (!plugin) {
    return { success: false, output: '', error: `Tool "${toolName}" not found in registry` };
  }

  try {
    const { z } = await import('zod');
    const schema = plugin.inputSchema;
    let validatedArgs: unknown = toolArgs;

    if (schema instanceof z.ZodType) {
      const parsed = schema.safeParse(toolArgs);
      if (!parsed.success) {
        return {
          success: false,
          output: '',
          error: `Validation failed for "${toolName}": ${parsed.error.issues.map(i => i.message).join(', ')}`,
        };
      }
      validatedArgs = parsed.data;
    }

    return await plugin.execute(validatedArgs, {
      workspacePath,
      sessionId,
      execGuard: {} as import('@clover/shared').ExecGuard,
      emitEvent: emit,
    });
  } catch (err) {
    return {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : 'Tool execution failed',
    };
  }
}
