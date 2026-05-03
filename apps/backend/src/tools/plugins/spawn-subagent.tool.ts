/**
 * Spawn-Subagent Tool Plugin — spawns an autonomous child agent for
 * task decomposition.
 *
 * The parent agent calls this tool with a `goal` (and optional
 * `agentType` / `systemPrompt`). The plugin:
 *
 *   1. Checks the current recursion depth against `config.maxSubagentDepth`.
 *   2. Creates an isolated {@link SubagentContext} via the factory.
 *   3. Returns a {@link ToolResult} with the subagent ID so the
 *      Orchestrator can dispatch execution (wired in task 7.5).
 *
 * Depth is tracked per session via a module-level Map so that nested
 * spawns within the same session are counted correctly.
 *
 * @module tools/plugins/spawn-subagent
 */

import { z } from 'zod';
import type { ToolPlugin, ToolContext, ToolResult } from '@clover/shared';
import { TOOL_NAMES } from '@clover/shared';
import { createSubagentContext } from '../../orchestrator/subagent-context.js';
import { MaxDepthExceededError } from '../../errors/subagent-errors.js';
import { config } from '../../config/config.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fallback when `config.maxSubagentDepth` is not set. */
const DEFAULT_MAX_DEPTH = 3;

// ---------------------------------------------------------------------------
// Depth tracking (per session)
// ---------------------------------------------------------------------------

/**
 * Module-level map tracking the current subagent nesting depth for each
 * session. The Orchestrator (or tests) can manipulate depth via the
 * exported helper functions.
 */
const depthBySession = new Map<string, number>();

/** Return the current depth for a session (0 if not yet tracked). */
export function getDepth(sessionId: string): number {
  return depthBySession.get(sessionId) ?? 0;
}

/** Increment the depth counter for a session and return the new value. */
export function incrementDepth(sessionId: string): number {
  const next = getDepth(sessionId) + 1;
  depthBySession.set(sessionId, next);
  return next;
}

/** Decrement the depth counter for a session (floors at 0). */
export function decrementDepth(sessionId: string): number {
  const next = Math.max(0, getDepth(sessionId) - 1);
  depthBySession.set(sessionId, next);
  return next;
}

/** Reset the depth counter for a session (e.g. on new top-level message). */
export function resetDepth(sessionId: string): void {
  depthBySession.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Zod input schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  /** The goal or task description for the subagent. */
  goal: z.string().min(1),
  /** Optional agent type for specialised behaviour (e.g. "test-writer"). */
  agentType: z.string().optional(),
  /** Optional system prompt to specialise the subagent's persona. */
  systemPrompt: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: TOOL_NAMES.SPAWN_SUBAGENT,

  description:
    'Spawn an autonomous subagent to handle a focused sub-task. ' +
    'The subagent runs its own pipeline with an isolated conversation ' +
    'history and returns a result to the parent agent.',

  inputSchema,

  /**
   * Spawning a subagent is a significant action — always require
   * confirmation so the user is aware of the delegation.
   */
  requiresConfirmation: () => true,

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(args);

    const maxDepth = config.maxSubagentDepth ?? DEFAULT_MAX_DEPTH;
    const currentDepth = getDepth(ctx.sessionId);

    // -----------------------------------------------------------------------
    // Depth guard — reject if we've hit the ceiling
    // -----------------------------------------------------------------------
    if (currentDepth >= maxDepth) {
      const err = new MaxDepthExceededError(currentDepth, maxDepth);
      return {
        success: false,
        output: '',
        error: err.message,
      };
    }

    // -----------------------------------------------------------------------
    // Create an isolated SubagentContext
    // -----------------------------------------------------------------------
    const subCtx = createSubagentContext({
      parentSessionId: ctx.sessionId,
      goal: parsed.goal,
      agentType: parsed.agentType,
      systemPrompt: parsed.systemPrompt,
      depth: currentDepth + 1,
      workspacePath: ctx.workspacePath,
    });

    // Bump the depth counter for this session
    incrementDepth(ctx.sessionId);

    // Emit a spawn event so the UI can show the subagent
    ctx.emitEvent('subagent:spawn', {
      subagentId: subCtx.id,
      parentSessionId: ctx.sessionId,
      goal: parsed.goal,
      agentType: parsed.agentType,
      depth: subCtx.depth,
    });

    // -----------------------------------------------------------------------
    // NOTE: Actual orchestrator dispatch is wired in task 7.5.
    // For now we return a placeholder result indicating the subagent was
    // created. The Orchestrator integration will replace this with the
    // real subagent execution + result injection.
    // -----------------------------------------------------------------------
    return {
      success: true,
      output:
        `Subagent spawned (id: ${subCtx.id}) at depth ${subCtx.depth}. ` +
        `Goal: "${parsed.goal}". ` +
        'Awaiting orchestrator dispatch (wired in task 7.5).',
    };
  },
};

export default plugin;
