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
  PatchParams,
  SearchFilesParams,
  GrepTextParams,
  OperationalContext,
} from './intent.types.js';
import { pipelineLog } from './pipeline.logger.js';
import { telemetryBus } from '../telemetry/telemetry.bus.js';

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
 * Handles both PT and EN, with fuzzy matching for common typos.
 */
function resolveWellKnownLocation(input: string): string | undefined {
  const normalized = stripAccents(input.toLowerCase());
  const homeDir = os.homedir();

  const LOCATIONS: Array<{ patterns: string[]; resolve: () => string }> = [
    {
      patterns: ['area de trabalho', 'desktop', 'area de trabalhe', 'area de trab', 'ambiente de trabalho'],
      resolve: () => path.join(homeDir, 'Desktop'),
    },
    {
      patterns: ['documentos', 'documents', 'meus documentos', 'docs'],
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
    {
      patterns: ['projeto', 'workspace', 'pasta do projeto', 'root do projeto'],
      resolve: () => process.env['CLOVER_WORKSPACE'] ?? process.cwd(),
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
  // HEURISTIC: Quoted string must be relatively short and contain path/file indicators
  const quoted = input.match(/["']([^"']{3,255})["']/);
  if (quoted) {
    const candidate = quoted[1];
    // If it has spaces AND doesn't have a clear extension/slash, it's probably content, not a path
    const hasSpace = /\s/.test(candidate);
    const hasPathIndicator = /[/\\.]/.test(candidate);
    const isShort = candidate.length < 50;

    if (hasPathIndicator && (isShort || !hasSpace)) {
      return candidate;
    }
  }

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

const DEICTIC_TOKENS = ['la', 'ali', 'ai', 'nele', 'nela', 'isso', 'esse', 'essa', 'naquele', 'naquela', 'dele', 'dela', 'aqui'];

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
/**
 * Resolve file path with strict priority:
 *   1. Well-known location keywords ("desktop", "área de trabalho") — dominant if present
 *   2. Explicit path in input (absolute or with extension)
 *   3. Natural language filename ("arquivo teste txt")
 *   4. Context lastFilePath (ONLY if deictic reference present AND no explicit path found)
 *   5. Workspace fallback
 */
function resolveFilePath(
  input: string,
  context: OperationalContext,
  workspacePath: string,
  defaultFilename?: string,
): { path: string; source: string } {
  const location = resolveWellKnownLocation(input);

  // 1. Explicit path (absolute or with extension)
  const explicit = extractPathFromText(input);
  if (explicit) {
    // If it's a relative path and we have a well-known location, combine them
    // BUT only if 'explicit' isn't just a repetition of the location (e.g., "Desktop/")
    if (location && !path.isAbsolute(explicit)) {
      const normalizedExplicit = explicit.toLowerCase().replace(/[/\\]+$/, '');
      const locationBase = path.basename(location).toLowerCase();
      
      if (normalizedExplicit === locationBase || normalizedExplicit === 'area de trabalho') {
        return { path: path.normalize(location), source: 'location_direct' };
      }
      
      return { path: path.normalize(path.join(location, explicit)), source: 'explicit+location' };
    }
    
    // If we have a location but explicit is absolute, explicit wins (likely user being specific)
    if (path.isAbsolute(explicit)) {
      return { path: path.normalize(explicit), source: 'explicit_absolute' };
    }

    const resolved = resolvePath(explicit, workspacePath);
    return { path: path.normalize(resolved), source: 'explicit' };
  }

  // 2. Natural language filename
  const naturalFile = extractNaturalFilename(input);
  if (naturalFile) {
    const base = location ?? workspacePath;
    return { path: path.normalize(path.join(base, naturalFile)), source: 'natural_filename' };
  }

  // 3. Well-known location only (no filename)
  if (location) {
    if (defaultFilename) {
      return { path: path.normalize(path.join(location, defaultFilename)), source: 'location+default' };
    }
    return { path: path.normalize(location), source: 'well_known_location' };
  }

  // 4. Context lastFilePath — ONLY with deictic reference
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
  {
    pattern: /^\s*(clear|cls)\s*$/i,
    resolve: () => `node -e "console.log('\\x1B[2J\\x1B[3J\\x1B[H')"`
  },
];

/** Extract params for execute_command. Uses LLM for natural language. */
export async function extractExecuteParams(
  input: string,
  workspacePath: string,
  model: string,
  sessionId: string,
): Promise<ExecuteParams> {
  const t0 = Date.now();
  let command = '';

  // 1. Try to extract a quoted command (fast path)
  const quoted = input.match(/["'`]([^"'`]+)["'`]/);
  if (quoted) {
    command = quoted[1];
  } else {
    // 2. Heuristic for simple direct commands
    const words = input.trim().split(/\s+/);
    const isQuestion = /^(você|voce|pode|consegue|quero|gostaria|como|por favor|vc|será|sera)/i.test(input);
    
    if (words.length <= 4 && !isQuestion) {
      command = input.replace(/^(execute|run|roda|executa|rode|execute o comando|run the command)\s*/i, '').trim();
    } else {
      // 3. LLM extraction for conversational requests
      const prompt = `Extract ONLY the shell/terminal command from the user request. No explanations, no markdown fences, no backticks.
If the user is just asking a question and there is no clear command to run, output exactly: INVALID_COMMAND
Request: ${input}
Command:`;

      try {
        const response = await ollamaClient.chat([{ role: 'user', content: prompt }], model);
        command = response.content.replace(/^```[a-z]*\r?\n?/i, '').replace(/```\s*$/i, '').trim();
        
        if (command === 'INVALID_COMMAND' || command === '') {
          command = 'echo "Error: Could not extract a valid command from the request."';
        }
      } catch {
        command = input.replace(/^(execute|run|roda|executa|rode)\s*/i, '').trim();
      }
    }
  }

  // Replace fragile commands with native equivalents
  for (const { pattern, resolve } of NATIVE_COMMAND_MAP) {
    if (pattern.test(command)) {
      command = resolve();
      break;
    }
  }

  pipelineLog({
    event: 'extract:done',
    sessionId,
    input,
    data: { intent: 'execute_command', command },
    durationMs: Date.now() - t0,
  });

  return { command, cwd: workspacePath };
}

// ---------------------------------------------------------------------------
// Patch intent extraction (Req 2.5.1–2.5.4)
// ---------------------------------------------------------------------------

/**
 * Determine whether the PatchEngine should be preferred over a full rewrite.
 * Returns true when the edit affects less than 30% of the file.
 *
 * @param fileLength  Total number of lines (or characters) in the file.
 * @param editSize    Number of lines (or characters) affected by the edit.
 */
export function shouldPreferPatch(fileLength: number, editSize: number): boolean {
  if (fileLength <= 0) return false;
  return editSize / fileLength < 0.30;
}

/**
 * Extract a line number or line range from natural language input.
 *
 * Recognises patterns:
 *   "edit line 42"           → { start: 42, end: 42 }
 *   "lines 10-20"           → { start: 10, end: 20 }
 *   "line 5 to 15"          → { start: 5, end: 15 }
 *   "linha 42"              → { start: 42, end: 42 }
 *   "linhas 10 a 20"        → { start: 10, end: 20 }
 */
function extractLineRange(input: string): { start: number; end: number } | undefined {
  const normalized = stripAccents(input.toLowerCase());

  // Range: "lines 10-20", "lines 10 to 20", "linhas 10 a 20", "linhas 10-20"
  const rangeMatch = normalized.match(
    /\b(?:lines?|linhas?)\s+(\d+)\s*(?:-|to|a|ate)\s*(\d+)\b/,
  );
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (start > 0 && end > 0) return { start, end };
  }

  // Single line: "line 42", "edit line 42", "linha 42"
  const singleMatch = normalized.match(
    /\b(?:line|linha)\s+(\d+)\b/,
  );
  if (singleMatch) {
    const line = parseInt(singleMatch[1], 10);
    if (line > 0) return { start: line, end: line };
  }

  return undefined;
}

/**
 * Extract search and replace strings from natural language input.
 *
 * Recognises patterns:
 *   "replace X with Y"          → { search: "X", replace: "Y" }
 *   "replace 'foo' with 'bar'"  → { search: "foo", replace: "bar" }
 *   "change X to Y"             → { search: "X", replace: "Y" }
 *   "substituir X por Y"        → { search: "X", replace: "Y" }
 *   "trocar X por Y"            → { search: "X", replace: "Y" }
 */
function extractSearchReplace(input: string): { search: string; replace: string } | undefined {
  const normalized = stripAccents(input);

  // Quoted variants: replace 'X' with 'Y', replace "X" with "Y"
  const quotedMatch = normalized.match(
    /\b(?:replace|change|substituir|trocar|troque)\s+["']([^"']+)["']\s+(?:with|to|por|para)\s+["']([^"']+)["']/i,
  );
  if (quotedMatch) {
    return { search: quotedMatch[1], replace: quotedMatch[2] };
  }

  // Unquoted: "replace X with Y" — capture up to the delimiter word
  const unquotedMatch = normalized.match(
    /\b(?:replace|change|substituir|trocar|troque)\s+(.+?)\s+(?:with|to|por|para)\s+(.+?)$/im,
  );
  if (unquotedMatch) {
    return { search: unquotedMatch[1].trim(), replace: unquotedMatch[2].trim() };
  }

  return undefined;
}

/**
 * Extract params for apply_patch.
 *
 * Heuristic extraction from natural language:
 *   - File path: explicit path in input or context lastFilePath
 *   - Search/replace: "replace X with Y", "change X to Y"
 *   - Line range: "edit line 42", "lines 10-20"
 *   - "change the function name" style → extract intent, LLM fills details later
 *
 * Requirements: 2.5.1, 2.5.2, 2.5.3
 */
export function extractPatchParams(
  input: string,
  context: OperationalContext,
  workspacePath: string,
): PatchParams {
  // 1. Resolve file path (same priority as other extractors)
  const resolved = resolveFilePath(input, context, workspacePath);
  const filePath = resolved.path;

  // 2. Extract search/replace strings
  const sr = extractSearchReplace(input);
  const searchString = sr?.search ?? '';
  const replaceString = sr?.replace ?? '';

  // 3. Extract optional line range (Req 2.5.3)
  const lineRange = extractLineRange(input);

  return {
    filePath,
    searchString,
    replaceString,
    ...(lineRange ? { lineRange } : {}),
  };
}

// ---------------------------------------------------------------------------
// Search intent extraction (Req 4.4.1–4.4.4)
// ---------------------------------------------------------------------------

/**
 * Extract a glob pattern from natural language input.
 *
 * Recognises patterns:
 *   "find all *.test.ts files"     -> **\/*.test.ts
 *   "find all test files"          -> **\/*.test.*
 *   "search for *.json files"      -> **\/*.json
 *   "find .ts files"               -> **\/*.ts
 *   "find all config files"        -> **\/config.*
 */
function extractGlobPattern(input: string): string | undefined {
  const normalized = input.toLowerCase();

  // Explicit glob/extension: "*.test.ts", "*.json", ".ts files"
  const explicitGlob = normalized.match(/\*\.[\w.*]+/);
  if (explicitGlob) {
    const pattern = explicitGlob[0];
    return pattern.startsWith('**/') ? pattern : `**/${pattern}`;
  }

  // Dot-prefixed extension: ".ts files", ".json files"
  const dotExt = normalized.match(/\.([\w]+)\s+files?\b/);
  if (dotExt) {
    return `**/*.${dotExt[1]}`;
  }

  // "all test files" → "**/*.test.*"
  if (/\ball\s+test\s+files?\b/.test(normalized)) {
    return '**/*.test.*';
  }

  // "all X files" where X is a known type keyword
  const typeKeyword = normalized.match(/\ball\s+([\w]+)\s+files?\b/);
  if (typeKeyword) {
    const keyword = typeKeyword[1];
    const EXTENSION_MAP: Record<string, string> = {
      typescript: 'ts',
      javascript: 'js',
      python: 'py',
      json: 'json',
      yaml: 'yaml',
      yml: 'yml',
      markdown: 'md',
      css: 'css',
      html: 'html',
      config: 'config.*',
      test: 'test.*',
      spec: 'spec.*',
    };
    const ext = EXTENSION_MAP[keyword];
    if (ext) {
      return `**/*.${ext}`;
    }
    // Treat the keyword as a filename stem: "all config files" → "**/config.*"
    return `**/${keyword}.*`;
  }

  return undefined;
}

/**
 * Extract a search query (identifier or text) from natural language input.
 *
 * Recognises patterns:
 *   "search for getUserName"           -> getUserName
 *   "where is handleClick defined"     -> handleClick
 *   "find where processData is called" -> processData
 *   "find 'TODO' in test files"        -> TODO
 *   "search for function X"            -> X
 */
function extractSearchQuery(input: string): string | undefined {
  // Quoted search term: "find 'TODO'", 'search for "FIXME"'
  const quoted = input.match(/["']([^"']+)["']/);
  if (quoted) return quoted[1];

  // "where is X defined" / "where is X used"
  const whereIs = input.match(/where\s+is\s+(\w+)\s+(?:defined|used|called|declared|implemented)/i);
  if (whereIs) return whereIs[1];

  // "where is X" (without qualifier)
  const whereIsSimple = input.match(/where\s+is\s+(\w+)/i);
  if (whereIsSimple) return whereIsSimple[1];

  // "search for (function|class|variable|method)? X"
  const searchFor = input.match(/search\s+for\s+(?:function\s+|class\s+|variable\s+|method\s+)?(\w+)/i);
  if (searchFor) return searchFor[1];

  // "find where X is called/used/defined"
  const findWhere = input.match(/find\s+where\s+(\w+)\s+is/i);
  if (findWhere) return findWhere[1];

  // "grep X" / "grep for X"
  const grep = input.match(/grep\s+(?:for\s+)?(\w+)/i);
  if (grep) return grep[1];

  return undefined;
}

/**
 * Extract an include pattern for combined searches.
 *
 * Recognises patterns:
 *   "find TODO in test files"       -> **\/*.test.*
 *   "find TODO in *.ts files"       -> **\/*.ts
 *   "search for X in python files"  -> **\/*.py
 */
function extractIncludePattern(input: string): string | undefined {
  const normalized = input.toLowerCase();

  // "in *.ext files" or "in .ext files"
  const inGlob = normalized.match(/\bin\s+(\*\.[\w.*]+)\s*files?\b/);
  if (inGlob) {
    const pattern = inGlob[1];
    return pattern.startsWith('**/') ? pattern : `**/${pattern}`;
  }

  const inDotExt = normalized.match(/\bin\s+\.([\w]+)\s*files?\b/);
  if (inDotExt) {
    return `**/*.${inDotExt[1]}`;
  }

  // "in test files" → "**/*.test.*"
  if (/\bin\s+test\s+files?\b/.test(normalized)) {
    return '**/*.test.*';
  }

  // "in X files" where X is a known type keyword
  const inType = normalized.match(/\bin\s+([\w]+)\s+files?\b/);
  if (inType) {
    const keyword = inType[1];
    const EXTENSION_MAP: Record<string, string> = {
      typescript: 'ts',
      javascript: 'js',
      python: 'py',
      json: 'json',
      yaml: 'yaml',
      yml: 'yml',
      markdown: 'md',
      css: 'css',
      html: 'html',
      config: 'config.*',
      test: 'test.*',
      spec: 'spec.*',
    };
    const ext = EXTENSION_MAP[keyword];
    if (ext) {
      return `**/*.${ext}`;
    }
  }

  return undefined;
}

/**
 * Determine whether the input is a combined search (content + file pattern).
 *
 * Combined searches like "find TODO in test files" should route to grep_text
 * with both `query` and `includePattern`.
 */
function isCombinedSearch(input: string): boolean {
  const normalized = input.toLowerCase();
  // Pattern: "find/search X in Y files"
  return /\b(?:find|search)\s+.+\s+in\s+\S+\s*files?\b/i.test(normalized);
}

/**
 * Extract params for search_files. Heuristic-only — no LLM needed.
 *
 * Requirements: 4.4.1, 4.4.2
 */
export function extractSearchFilesParams(
  input: string,
): SearchFilesParams {
  const pattern = extractGlobPattern(input) ?? '**/*';

  // Extract optional maxResults
  const maxMatch = input.match(/\b(?:max|limit|top)\s*[=:]\s*(\d+)/i);
  const maxResults = maxMatch ? parseInt(maxMatch[1], 10) : undefined;

  return {
    pattern,
    ...(maxResults ? { maxResults } : {}),
  };
}

/**
 * Extract params for grep_text. Heuristic-only — no LLM needed.
 *
 * Requirements: 4.4.1, 4.4.3, 4.4.4
 */
export function extractGrepTextParams(
  input: string,
): GrepTextParams {
  const query = extractSearchQuery(input) ?? '';
  const includePattern = extractIncludePattern(input);

  // Check for explicit case-sensitive flag
  const caseSensitive = /\bcase[- ]?sensitive\b/i.test(input) ? true : undefined;

  return {
    query,
    ...(includePattern ? { includePattern } : {}),
    ...(caseSensitive !== undefined ? { caseSensitive } : {}),
  };
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
  traceId?: string,
): Promise<ExtractedParams> {
  const t0 = Date.now();
  let result: ExtractedParams;

  switch (intent) {
    case 'write_file':
      result = {
        intent: 'write_file',
        params: await extractWriteParams(input, context, workspacePath, model, sessionId),
      };
      break;
    case 'read_file':
      result = { intent: 'read_file', params: extractReadParams(input, context, workspacePath) };
      break;
    case 'list_files':
      result = { intent: 'list_files', params: extractListParams(input, context, workspacePath) };
      break;
    case 'delete_file':
      result = { intent: 'delete_file', params: extractDeleteParams(input, context, workspacePath) };
      break;
    case 'execute_command':
      result = { intent: 'execute_command', params: await extractExecuteParams(input, workspacePath, model, sessionId) };
      break;
    case 'apply_patch':
      result = { intent: 'apply_patch', params: extractPatchParams(input, context, workspacePath) };
      break;
    case 'search_files':
      result = { intent: 'search_files', params: extractSearchFilesParams(input) };
      break;
    case 'grep_text':
      result = { intent: 'grep_text', params: extractGrepTextParams(input) };
      break;
    default:
      result = { intent, params: null };
      break;
  }

  if (traceId) {
    const durationMs = Date.now() - t0;
    // Determine the source tool name from the intent
    const INTENT_TO_TOOL: Partial<Record<IntentLabel, string>> = {
      write_file: 'write-file',
      read_file: 'read-file',
      list_files: 'list-files',
      delete_file: 'delete-file',
      execute_command: 'execute-command',
      apply_patch: 'apply-patch',
      search_files: 'search-files',
      grep_text: 'grep-text',
    };
    telemetryBus.emitEvent({
      traceId,
      stage: 'extractor',
      timestamp: t0,
      durationMs,
      status: 'success',
      metadata: {
        intent,
        sourceTool: INTENT_TO_TOOL[intent] ?? null,
        hasParams: result.params !== null,
      },
    });
  }

  return result;
}
