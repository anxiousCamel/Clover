/**
 * SubagentContext — isolated execution context for a child agent.
 *
 * Each subagent gets its own chat history and token budget while
 * inheriting the parent's workspace path and permissions. The context
 * is stored in-memory (not persisted) and lives only for the duration
 * of the subagent's execution.
 *
 * @module orchestrator/subagent-context
 */

import { randomUUID } from 'node:crypto';
import type { Message } from '@clover/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default token budget allocated to a subagent when none is specified. */
const DEFAULT_TOKEN_BUDGET = 4096;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Isolated execution context for a spawned subagent.
 *
 * Created via {@link createSubagentContext} and tracked by the
 * Orchestrator in a `Map<string, SubagentContext>`.
 */
export interface SubagentContext {
  /** Unique identifier (UUID) for this subagent instance. */
  id: string;
  /** Session ID of the parent agent that spawned this subagent. */
  parentSessionId: string;
  /** The goal or task description assigned to this subagent. */
  goal: string;
  /** Optional agent type for specialised behaviour (e.g. "test-writer"). */
  agentType?: string;
  /** Optional system prompt to specialise the subagent's persona. */
  systemPrompt?: string;
  /** Current nesting level (0 = top-level agent, 1 = first subagent, …). */
  depth: number;
  /** Isolated conversation history — independent from the parent's history. */
  chatHistory: Message[];
  /** Absolute workspace path inherited from the parent agent. */
  workspacePath: string;
  /** Independent token budget for this subagent's execution. */
  tokenBudget: number;
  /** Current execution status. */
  status: 'running' | 'completed' | 'failed';
  /** Final result text once the subagent completes (or error message on failure). */
  result?: string;
}

// ---------------------------------------------------------------------------
// Factory options
// ---------------------------------------------------------------------------

/** Options accepted by {@link createSubagentContext}. */
export interface CreateSubagentContextOptions {
  /** Session ID of the parent agent. */
  parentSessionId: string;
  /** The goal or task description for the subagent. */
  goal: string;
  /** Optional agent type identifier. */
  agentType?: string;
  /** Optional system prompt to specialise the subagent. */
  systemPrompt?: string;
  /** Current nesting depth (parent's depth + 1). */
  depth: number;
  /** Workspace path inherited from the parent agent. */
  workspacePath: string;
  /** Token budget for the subagent. Defaults to {@link DEFAULT_TOKEN_BUDGET}. */
  tokenBudget?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new {@link SubagentContext} with an isolated chat history
 * and independent token budget.
 *
 * The workspace path and permissions are inherited from the parent
 * context via the provided options.
 *
 * @param options - Configuration for the new subagent context.
 * @returns A fresh `SubagentContext` in `'running'` status.
 */
export function createSubagentContext(
  options: CreateSubagentContextOptions,
): SubagentContext {
  return {
    id: randomUUID(),
    parentSessionId: options.parentSessionId,
    goal: options.goal,
    agentType: options.agentType,
    systemPrompt: options.systemPrompt,
    depth: options.depth,
    chatHistory: [],          // isolated — not shared with parent
    workspacePath: options.workspacePath,
    tokenBudget: options.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
    status: 'running',
  };
}
