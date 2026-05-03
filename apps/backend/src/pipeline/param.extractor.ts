/**
 * Parameter Extractor — extracts typed, structured parameters per intent.
 *
 * Priority for path resolution (STRICT ORDER):
 *   1. Explicit path in input (absolute or filename)
 *   2. Well-known location keywords ("desktop", "área de trabalho")
 *   3. Context lastFilePath (only for deictic references)
 *   4. Workspace fallback
 *
 * @module pipeline/param.extractor
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
// Accent normalization
// ---------------------------------------------------------------------------

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ---------------------------------------------------------------------------
// OS-aware path resolution
// ---------------------------------------------------------------------------

/**
 * Map well-known location keywords to actual OS paths.
 * Handles both PT and EN, with accent normalization.
 */
function resolveWellKnownLocation(input: string): string | undefined {
  const normalized = stripAccents(input.toLowerCase());
  const homeDir = os.homedir();

  const LOCATIONS: Array<{ patterns: string[]; resolve: () => string }> = [
    {
      patterns: ['area de trabalho', 'desktop'],
      resolve: () => path.join(homeDir, 'Desktop'),
    },
    {
      patterns: ['documentos', 'documents', 'meus documentos'],
      resolve: () => path.join(homeDir, 'Documents'),
    },
    {
      patterns: ['downloads', 'download'],
      resolve: () => path.join(homeDir, 'Downloads'),
    },
    {
      patterns: ['home', 'pasta pessoal', 'pasta do usuario'],
      resolve: () => homeDir,
    },
  ];

  for (const loc of LOCATIONS) {
    if (loc.patterns.some(p => normalized.includes(p))) {
      return loc.resolve();
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Path extraction helpers
// ---------------------------------------------------------------------------

/** Extract the first recognisable file path from free text. */
function extractPathFromText(input: string): string | undefined {
  // Windows absolute: C:\... or C:/...
  const winAbs = input.match(/[A-Za-z]:[/\\][^\s'"`,;)]+/);
  if (winAbs) return winAbs[0].replace(/[.,;)]+$/, '');

  // Unix absolute: /home/... /tmp/...
  const unixAbs = input.match(/\/(?:home|tmp|var|usr|etc|opt)[^\s'"`,;)]+/);
  if (unixAbs) return unixAbs[0].replace(/[.,;)]+$/, '');

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

/**
 * Extract filename from natural language patterns like:
 *   "o arquivo teste txt" → "teste.txt"
 *   "arquivo config json" → "config.json"
 */
function extractNaturalFilename(input: string): string | undefined {
  const normalized = stripAccents(input.toLowerCase());
  const match = normalized.match(
    /(?:arquivo|file|ficheiro)\s+([a-z0-9_-]+)\s+(txt|md|json|ts|js|py|csv|xml|yaml|yml|log|sh|ps1|html|css|ini|env)\b/i,
  );
  if (match) return `${match[1]}.${match[2]}`;
  return undefined;
}

function resolvePath(filePath: string, workspacePath: string): string {
  if (path.isAbsolute(filePath)) return path.normalize(filePath);
  return path.resolve(workspacePath, filePath);
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

export interface PathValidation {
  valid: boolean;
  resolvedPath: string;
  error?: string;
  isDirectory?: boolean;
  exists?: boolean;
}

/**
 * Validate a resolved path before tool execution.
 * Checks existence, type (file vs directory), and basic sanity.
 */
export function validatePath(
  resolvedPath: string,
  intent: IntentLabel,
): PathValidation {
  const normalized = path.normalize(resolvedPath);
  const exists = fs.existsSync(normalized);
  let isDirectory = false;

  if (exists) {
    try {
      isDirectory = fs.statSync(normalized).isDirectory();
    } catch {
      // stat failed — treat as non-existent
    }
  }

  // write_file to a directory path → error
  if (intent === 'write_file' && exists && isDirectory) {
    return {
      valid: false,
      resolvedPath: normalized,
      error: `Cannot write: "${normalized}" is a directory, not a file`,
      isDirectory,
      exists,
    };
  }

  // read_file on a directory → error (should be list_files)
  if (intent === 'read_file' && exists && isDirectory) {
    return {
      valid: false,
      resolvedPath: normalized,
      error: `Cannot read: "${normalized}" is a directory. Use list_files instead`,
      isDirectory,
      exists,
    };
  }

  // delete_file on a directory → error
  if (intent === 'delete_file' && exists && isDirectory) {
    return {
      valid: false,
      resolvedPath: normalized,
      error: `Cannot delete: "${normalized}" is a directory`,
      isDirectory,
      exists,
    };
  }

  // read_file / delete_file on non-existent path → error
  if ((intent === 'read_file' || intent === 'delete_file') && !exists) {
    return {
      valid: false,
      resolvedPath: normalized,
      error: `Path does not exist: "${normalized}"`,
      isDirectory: false,
      exists: false,
    };
  }

  // list_files on a file → error
  if (intent === 'list_files' && exists && !isDirectory) {
    return {
      valid: false,
      resolvedPath: normalized,
      error: `Cannot list: "${normalized}" is a file, not a directory`,
      isDirectory,
      exists,
    };
  }

  return { valid: true, resolvedPath: normalized, isDirectory, exists };
}

// ---------------------------------------------------------------------------
// Deictic detection
// ---------------------------------------------------------------------------

const DEICTIC_TOKENS = ['la', 'ali', 'ai', 'nele', 'nela', 'isso', 'esse', 'essa', 'naquele', 'naquela'];

function hasDeictic(input: string): boolean {
  const normalized = stripAccents(input.toLowerCase());
  return DEICTIC_TOKENS.some(d => {
    const regex = new RegExp(`\\b${d}\\b`);
    return regex.test(normalized);
  });
}

// ---------------------------------------------------------------------------
// Path resolution with strict priority
// ---------------------------------------------------------------------------

/**
 * Resolve file path with strict priority:
 *   1. Explicit path in input (absolute or with extension)
 *   2. Natural language filename ("arquivo teste txt")
 *   3. Well-known location ("desktop", "área de trabalho")
 *   4. Context lastFilePath (ONLY if deictic reference present AND no explicit path found)
 *   5. Workspace fallback
 */
function resolveFilePath(
  input: string,
  context: OperationalContext,
  workspacePath: string,
  defaultFilename?: string,
): { path: string; source: string } {
  // 1. Explicit path (absolute or with extension)
  const explicit = extractPathFromText(input);
  if (explicit) {
    const location = resolveWellKnownLocation(input);
    // If it's a relative path and we have a well-known location, combine them
    if (location && !path.isAbsolute(explicit)) {
      return { path: path.normalize(path.join(location, explicit)), source: 'explicit+location' };
    }
    const resolved = resolvePath(explicit, workspacePath);
    return { path: path.normalize(resolved), source: 'explicit' };
  }

  // 2. Natural language filename
  const naturalFile = extractNaturalFilename(input);
  if (naturalFile) {
    const location = resolveWellKnownLocation(input);
    const base = location ?? workspacePath;
    return { path: path.normalize(path.join(base, naturalFile)), source: 'natural_filename' };
  }

  // 3. Well-known location only (no filename)
  const location = resolveWellKnownLocation(input);
  if (location) {
    if (defaultFilename) {
      return { path: path.normalize(path.join(location, defaultFilename)), source: 'location+default' };
    }
    return { path: path.normalize(location), source: 'well_known_location' };
  }

  // 4. Context lastFilePath — ONLY with deictic reference
  // This is a CRITICAL fallback, only used if the user didn't specify a new path.
  if (hasDeictic(input) && context.lastFilePath) {
    return { path: path.normalize(context.lastFilePath), source: 'context_deictic' };
  }

  // 5. Workspace fallback
  if (defaultFilename) {
    return { path: path.normalize(path.join(workspacePath, defaultFilename)), source: 'workspace_default' };
  }
  return { path: path.normalize(workspacePath), source: 'workspace_fallback' };
}

// ---------------------------------------------------------------------------
// Per-intent extractors (public)
// ---------------------------------------------------------------------------

/**
 * Extract params for write_file.
 * Path: explicit > natural filename > well-known location > deictic context > workspace/output.txt
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

  const resolved = resolveFilePath(input, context, workspacePath, 'output.txt');

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
    content = context.lastGeneratedContent;
    contentSource = 'context_deictic';
  } else {
    content = await generateContent(input, resolved.path, model);
    contentSource = 'llm_generated';
  }

  pipelineLog({
    event: 'extract:done',
    sessionId,
    input,
    data: {
      intent: 'write_file',
      path: resolved.path,
      contentLength: content.length,
      contentSource,
      pathSource: resolved.source,
    },
    durationMs: Date.now() - t0,
  });

  return { path: resolved.path, content };
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
  const resolved = resolveFilePath(input, context, workspacePath);
  return { path: resolved.path };
}

/** Extract params for list_files. Heuristic-only. */
export function extractListParams(
  input: string,
  context: OperationalContext,
  workspacePath: string,
): ListParams {
  const resolved = resolveFilePath(input, context, workspacePath);

  const depthMatch = input.match(/\b(?:profundidade|depth|nível|nivel)\s*[=:]\s*(\d)/i);
  const depth = depthMatch ? parseInt(depthMatch[1], 10) : 1;

  return { path: resolved.path, depth };
}

/** Extract params for delete_file. Heuristic-only. */
export function extractDeleteParams(
  input: string,
  context: OperationalContext,
  workspacePath: string,
): DeleteParams {
  const resolved = resolveFilePath(input, context, workspacePath);
  return { path: resolved.path };
}

/**
 * Commands that are fragile across OS environments.
 * Map them to Node.js native equivalents that always work.
 */
const NATIVE_COMMAND_MAP: Array<{ pattern: RegExp; resolve: () => string }> = [
  {
    pattern: /^\s*whoami\s*$/i,
    resolve: () => {
      const info = os.userInfo();
      return `echo ${info.username}`;
    },
  },
  {
    pattern: /^\s*hostname\s*$/i,
    resolve: () => `echo ${os.hostname()}`,
  },
  {
    pattern: /^\s*pwd\s*$/i,
    resolve: () => `echo ${process.cwd()}`,
  },
];

/** Extract params for execute_command. Heuristic-only. */
export function extractExecuteParams(
  input: string,
  workspacePath: string,
): ExecuteParams {
  // Try to extract a quoted command
  const quoted = input.match(/["'`]([^"'`]+)["'`]/);
  let command = quoted ? quoted[1] : input
    .replace(/^(execute|run|roda|executa|rode|execute o comando|run the command)\s*/i, '')
    .trim();

  // Replace fragile commands with native equivalents
  for (const { pattern, resolve } of NATIVE_COMMAND_MAP) {
    if (pattern.test(command)) {
      command = resolve();
      break;
    }
  }

  return { command, cwd: workspacePath };
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
