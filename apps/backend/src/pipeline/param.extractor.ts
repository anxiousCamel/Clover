/**
 * Parameter Extractor — extracts typed, structured parameters per intent.
 *
 * Completely separate from classification. Each extractor function is
 * independent and uses OperationalContext fallbacks when parameters
 * are implicit ("coloca lá" → use lastFilePath and lastGeneratedContent).
 *
 * @module pipeline/param.extractor
 */

import path from 'node:path';
import * as ollamaClient from '../ollama/ollama.client.js';
import type {
  IntentLabel,
  ExtractedParams,
  WriteParams,
  ReadParams,
  ListParams,
  DeleteParams,
  ExecuteParams,
  OperationalContext,
} from './intent.types.js';
import { pipelineLog } from './pipeline.logger.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Extract the first recognisable file path from free text. */
function extractPathFromText(input: string): string | undefined {
  // Windows absolute: C:\... or C:/...
  const winAbs = input.match(/[A-Za-z]:[/\\][^\s'"`,;)]+/);
  if (winAbs) return winAbs[0].replace(/[.,;)]+$/, '');

  // Quoted path or filename
  const quoted = input.match(/["']([^"']{3,})["']/);
  if (quoted && /[/\\.]/.test(quoted[1])) return quoted[1];

  // Bare filename with extension (common types)
  const bare = input.match(
    /\b([^\s/\\:*?"<>|]+\.(txt|md|json|ts|js|py|csv|xml|yaml|yml|log|sh|ps1|html|css|ini|env))\b/i,
  );
  if (bare) return bare[1];

  return undefined;
}

function resolvePath(filePath: string, workspacePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(workspacePath, filePath);
}

// ---------------------------------------------------------------------------
// Deictic detection
// ---------------------------------------------------------------------------

const DEICTIC_TOKENS = ['lá', 'ali', 'aí', 'nele', 'nela', 'isso', 'esse', 'essa', 'naquele', 'naquela'];

function hasDeictic(input: string): boolean {
  const lower = input.toLowerCase();
  return DEICTIC_TOKENS.some(d => lower.includes(d));
}

// ---------------------------------------------------------------------------
// Per-intent extractors (public)
// ---------------------------------------------------------------------------

/**
 * Extract params for write_file.
 * Path: explicit in input → context.lastFilePath → workspace/output.txt
 * Content: inline quoted → deictic (lastGeneratedContent) → LLM-generated
 */
export async function extractWriteParams(
  input: string,
  context: OperationalContext,
  workspacePath: string,
  model: string,
  sessionId: string,
): Promise<WriteParams> {
  const t0 = Date.now();

  // Resolve path
  const explicitPath = extractPathFromText(input);
  const targetPath = explicitPath
    ? resolvePath(explicitPath, workspacePath)
    : context.lastFilePath ?? path.join(workspacePath, 'output.txt');

  // Resolve content
  let content: string;
  let contentSource: string;

  // Inline quoted content (>10 chars)
  const inlineQuoted = input.match(/["']([^"']{10,})["']/);
  const afterColon = input.match(/:\s*(.{10,})$/s);

  if (inlineQuoted) {
    content = inlineQuoted[1];
    contentSource = 'inline_quoted';
  } else if (afterColon) {
    content = afterColon[1].trim();
    contentSource = 'after_colon';
  } else if (hasDeictic(input) && context.lastGeneratedContent) {
    // "coloca lá" / "salva isso" → reuse last generated content
    content = context.lastGeneratedContent;
    contentSource = 'context_deictic';
  } else {
    // Ask LLM to generate the content
    content = await generateContent(input, targetPath, model);
    contentSource = 'llm_generated';
  }

  pipelineLog({
    event: 'extract:done',
    sessionId,
    input,
    data: {
      intent: 'write_file',
      path: targetPath,
      contentLength: content.length,
      contentSource,
      pathSource: explicitPath ? 'explicit' : 'context',
    },
    durationMs: Date.now() - t0,
  });

  return { path: targetPath, content };
}

/** Generate file content via LLM from a natural-language request. */
async function generateContent(
  userRequest: string,
  targetPath: string,
  model: string,
): Promise<string> {
  const prompt = `Generate ONLY the file content below. No explanations, no markdown fences.
File: ${path.basename(targetPath)}
Request: ${userRequest}
Content:`;

  try {
    const response = await ollamaClient.chat([{ role: 'user', content: prompt }], model);
    return response.content
      .replace(/^```[a-z]*\r?\n?/i, '')
      .replace(/```\s*$/i, '')
      .trim();
  } catch {
    return `# ${path.basename(targetPath)}\n\nConteúdo gerado automaticamente.\n`;
  }
}

/** Extract params for read_file. Heuristic-only — no LLM needed. */
export function extractReadParams(
  input: string,
  context: OperationalContext,
  workspacePath: string,
): ReadParams {
  const explicit = extractPathFromText(input);
  return {
    path: explicit
      ? resolvePath(explicit, workspacePath)
      : context.lastFilePath ?? workspacePath,
  };
}

/** Extract params for list_files. Heuristic-only. */
export function extractListParams(
  input: string,
  context: OperationalContext,
  workspacePath: string,
): ListParams {
  const explicit = extractPathFromText(input);
  const dirPath = explicit
    ? resolvePath(explicit, workspacePath)
    : workspacePath;

  const depthMatch = input.match(/\b(?:profundidade|depth|nível|nivel)\s*[=:]\s*(\d)/i);
  const depth = depthMatch ? parseInt(depthMatch[1], 10) : 1;

  return { path: dirPath, depth };
}

/** Extract params for delete_file. Heuristic-only. */
export function extractDeleteParams(
  input: string,
  context: OperationalContext,
  workspacePath: string,
): DeleteParams {
  const explicit = extractPathFromText(input);
  return {
    path: explicit
      ? resolvePath(explicit, workspacePath)
      : context.lastFilePath ?? workspacePath,
  };
}

/** Extract params for execute_command. Heuristic-only. */
export function extractExecuteParams(
  input: string,
  workspacePath: string,
): ExecuteParams {
  // Try to extract a quoted command
  const quoted = input.match(/["'`]([^"'`]+)["'`]/);
  if (quoted) return { command: quoted[1], cwd: workspacePath };

  // Strip common imperative prefixes and use the rest as the command
  const stripped = input
    .replace(/^(execute|run|roda|executa|rode|execute o comando|run the command)\s*/i, '')
    .trim();

  return { command: stripped, cwd: workspacePath };
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

/**
 * Extract structured parameters for a classified intent.
 * Returns null params for 'chat' and 'unknown' intents.
 */
export async function extractParams(
  input: string,
  intent: IntentLabel,
  context: OperationalContext,
  workspacePath: string,
  model: string,
  sessionId: string,
): Promise<ExtractedParams> {
  switch (intent) {
    case 'write_file':
      return {
        intent: 'write_file',
        params: await extractWriteParams(input, context, workspacePath, model, sessionId),
      };
    case 'read_file':
      return { intent: 'read_file', params: extractReadParams(input, context, workspacePath) };
    case 'list_files':
      return { intent: 'list_files', params: extractListParams(input, context, workspacePath) };
    case 'delete_file':
      return { intent: 'delete_file', params: extractDeleteParams(input, context, workspacePath) };
    case 'execute_command':
      return { intent: 'execute_command', params: extractExecuteParams(input, workspacePath) };
    default:
      return { intent, params: null };
  }
}
