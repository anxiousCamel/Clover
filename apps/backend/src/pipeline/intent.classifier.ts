/**
 * Intent Classifier — LLM-backed with in-memory cache.
 *
 * Uses a tight prompt (~120 tokens) to classify user input into a
 * fixed IntentLabel. The cache (global, max 500 entries) avoids
 * repeated LLM calls for identical or near-identical inputs.
 *
 * Resolution order: cache → context shortcut → LLM → fallback(unknown)
 *
 * @module pipeline/intent.classifier
 */

import * as ollamaClient from '../ollama/ollama.client.js';
import type { ClassifyResult, IntentLabel, OperationalContext } from './intent.types.js';
import { pipelineLog } from './pipeline.logger.js';

// ---------------------------------------------------------------------------
// Cache (global, LRU-lite)
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: ClassifyResult;
  hitCount: number;
}

const classifyCache = new Map<string, CacheEntry>();
const CACHE_MAX_SIZE = 500;

function normalizeKey(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, ' ');
}

function cacheGet(key: string): ClassifyResult | undefined {
  const entry = classifyCache.get(key);
  if (entry) {
    entry.hitCount++;
    return entry.result;
  }
  return undefined;
}

function cacheSet(key: string, result: ClassifyResult): void {
  if (classifyCache.size >= CACHE_MAX_SIZE) {
    const firstKey = classifyCache.keys().next().value;
    if (firstKey !== undefined) classifyCache.delete(firstKey);
  }
  classifyCache.set(key, { result, hitCount: 0 });
}

export function getCacheStats() {
  return {
    size: classifyCache.size,
    topEntries: Array.from(classifyCache.entries())
      .sort((a, b) => b[1].hitCount - a[1].hitCount)
      .slice(0, 10)
      .map(([key, v]) => ({ key, hitCount: v.hitCount })),
  };
}

export function clearClassifyCache(): void {
  classifyCache.clear();
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const VALID_INTENTS = new Set<IntentLabel>([
  'write_file', 'read_file', 'list_files', 'delete_file', 'execute_command', 'chat',
]);

const DEICTIC_TOKENS = ['lá', 'ali', 'aí', 'nele', 'nela', 'isso', 'esse', 'essa', 'naquele', 'naquela'];

function buildPrompt(input: string, ctx: OperationalContext): string {
  const hints = [
    ctx.lastFilePath ? `Last file: ${ctx.lastFilePath}` : '',
    ctx.lastIntent ? `Last action: ${ctx.lastIntent}` : '',
  ].filter(Boolean).join('. ');

  return `Classify intent. Reply with ONE label only, nothing else.

Labels:
- write_file: create/write/edit/add/update/save content in a file
- read_file: read/show/open/display file content
- list_files: list/show files in a folder or directory
- delete_file: delete/remove/erase a file
- execute_command: run/execute a shell command or script
- chat: questions, conversation, greetings, everything else

Rules:
- Deictic refs (lá, ali, aí, isso, nele) + prior context → reuse last action
- Absolute or relative file path present → file intent
${hints ? `Context: ${hints}` : ''}

Input: ${input}
Label:`;
}

/**
 * Classify the intent of a user input.
 *
 * @param input     - Raw user message.
 * @param context   - Operational context from the current session.
 * @param model     - Ollama model name.
 * @param sessionId - Session ID for logging.
 */
export async function classifyIntent(
  input: string,
  context: OperationalContext,
  model: string,
  sessionId: string,
): Promise<ClassifyResult> {
  const key = normalizeKey(input);
  const t0 = Date.now();

  // 1. Cache hit
  const cached = cacheGet(key);
  if (cached) {
    pipelineLog({ event: 'classify:cache_hit', sessionId, input, data: { intent: cached.intent } });
    return cached;
  }

  // 2. Context shortcut — deictic ref + known prior intent
  const lower = input.toLowerCase();
  const hasDeictic = DEICTIC_TOKENS.some(d => lower.includes(d));
  const hasActionContext =
    context.lastIntent &&
    context.lastIntent !== 'chat' &&
    context.lastIntent !== 'unknown';

  if (hasDeictic && hasActionContext) {
    const result: ClassifyResult = {
      intent: context.lastIntent!,
      confidence: 0.85,
      source: 'context',
    };
    cacheSet(key, result);
    pipelineLog({ event: 'classify:context', sessionId, input, data: { intent: result.intent } });
    return result;
  }

  // 3. LLM
  try {
    const response = await ollamaClient.chat(
      [{ role: 'user', content: buildPrompt(input, context) }],
      model,
    );

    const raw = response.content.trim().toLowerCase().replace(/[^a-z_]/g, '');
    const intent: IntentLabel = VALID_INTENTS.has(raw as IntentLabel)
      ? (raw as IntentLabel)
      : 'unknown';

    const result: ClassifyResult = {
      intent,
      confidence: intent === 'unknown' ? 0.3 : 0.9,
      source: 'llm',
    };

    cacheSet(key, result);
    pipelineLog({
      event: 'classify:llm',
      sessionId,
      input,
      data: { intent, raw, model },
      durationMs: Date.now() - t0,
    });

    return result;
  } catch (err) {
    pipelineLog({
      event: 'classify:error',
      sessionId,
      input,
      error: err instanceof Error ? err.message : String(err),
    });
    return { intent: 'unknown', confidence: 0, source: 'llm' };
  }
}
