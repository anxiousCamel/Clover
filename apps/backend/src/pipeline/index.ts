/**
 * Intent Pipeline — main orchestrator.
 *
 * Orchestrates the full pipeline:
 *   Input → HeuristicGate → LLMClassifier → ParamExtractor → ExecutionRouter
 *
 * The result (PipelineDecision) tells the agent engine whether to force
 * a tool execution or fall through to normal agent dispatch.
 *
 * @module pipeline/index
 */

import { evaluateGate } from './heuristic.gate.js';
import { classifyIntent } from './intent.classifier.js';
import { extractParams } from './param.extractor.js';
import { routeExecution } from './execution.router.js';
import { getContext, updateContext } from './context.store.js';
import { pipelineLog } from './pipeline.logger.js';
import type { PipelineDecision, ClassifyResult } from './intent.types.js';

// Re-export public surface
export { initPipelineLogger } from './pipeline.logger.js';
export { getContext, updateContext, clearContext } from './context.store.js';
export { getCacheStats, clearClassifyCache } from './intent.classifier.js';
export type { PipelineDecision, OperationalContext } from './intent.types.js';

// ---------------------------------------------------------------------------
// Pipeline entry point
// ---------------------------------------------------------------------------

export interface RunPipelineOptions {
  /** Raw user message. */
  input: string;
  /** Session ID for context lookup and logging. */
  sessionId: string;
  /** Workspace root (used for path resolution). */
  workspacePath: string;
  /** Ollama model to use for classification and content generation. */
  model: string;
}

/**
 * Run the full intent pipeline for a user input.
 *
 * Returns a PipelineDecision:
 * - mode='execute': call toolName with toolArgs immediately (no LLM turn)
 * - mode='chat':    fall through to normal agent dispatch
 */
export async function runPipeline(opts: RunPipelineOptions): Promise<PipelineDecision> {
  const { input, sessionId, workspacePath, model } = opts;
  const context = getContext(sessionId);

  // Step 1 — Heuristic gate (< 1ms, no LLM)
  const gate = evaluateGate(input);

  if (!gate.looksLikeAction) {
    pipelineLog({
      event: 'gate:block',
      sessionId,
      input,
      data: { score: gate.score, features: gate.features },
    });
    const chatClassify: ClassifyResult = { intent: 'chat', confidence: 1, source: 'heuristic' };
    return { mode: 'chat', classify: chatClassify };
  }

  pipelineLog({
    event: 'gate:pass',
    sessionId,
    input,
    data: { score: gate.score, features: gate.features },
  });

  // Step 2 — LLM intent classifier (with cache)
  const classify = await classifyIntent(input, context, model, sessionId);

  if (classify.intent === 'chat' || classify.intent === 'unknown') {
    return { mode: 'chat', classify };
  }

  // Step 3 — Parameter extraction
  const extracted = await extractParams(input, classify.intent, context, workspacePath, model, sessionId);

  // Step 4 — Execution router (tool forcing)
  const decision = routeExecution(extracted, classify, sessionId);

  // Step 5 — Update operational context for the next turn
  updateContext(sessionId, { lastIntent: classify.intent });

  if (decision.mode === 'execute' && decision.toolArgs) {
    const args = decision.toolArgs;
    if (typeof args['path'] === 'string') {
      updateContext(sessionId, { lastFilePath: args['path'] });
    }
    if (classify.intent === 'write_file' && typeof args['content'] === 'string') {
      updateContext(sessionId, { lastGeneratedContent: args['content'] });
    }
  }

  return decision;
}
