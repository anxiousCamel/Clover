/**
 * dev/search — Fallback Node para `search_code` quando não há Ripgrep no PATH.
 *
 * Walker iterativo (sem recursão de pilha), limitado: pula `.git`/`node_modules`,
 * ignora arquivos > 1 MiB e binários (byte NUL), e para no teto de resultados.
 * Lê sob a raiz do workspace (a tool valida a fronteira antes de chamar).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const MAX_FILE_BYTES = 1024 * 1024;

export interface CodeMatch {
  file: string;
  line: number;
  text: string;
}

export interface SearchResult {
  matches: CodeMatch[];
  truncated: boolean;
}

/** Busca literal por `needle` sob `root`; caminhos relativos a `rootForRel`. */
export function walkSearch(
  root: string,
  rootForRel: string,
  needle: string,
  ignoreCase: boolean,
  cap: number,
): SearchResult {
  const matches: CodeMatch[] = [];
  const hay = ignoreCase ? needle.toLowerCase() : needle;
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // sem permissão / removido — ignora
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      let content: string;
      try {
        if (statSync(full).size > MAX_FILE_BYTES) continue;
        content = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (content.includes('\0')) continue; // binário
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const hayLine = ignoreCase ? lines[i].toLowerCase() : lines[i];
        if (hayLine.includes(hay)) {
          matches.push({ file: relative(rootForRel, full).replace(/\\/g, '/'), line: i + 1, text: lines[i] });
          if (matches.length >= cap) return { matches, truncated: true };
        }
      }
    }
  }
  return { matches, truncated: false };
}

/** Parser da saída do Ripgrep (`path:line:text`), com teto de resultados. */
export function parseRgLines(stdout: string, cap: number): SearchResult {
  const matches: CodeMatch[] = [];
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const m = line.match(/^(.*?):(\d+):(.*)$/);
    if (!m) continue;
    matches.push({ file: m[1].replace(/\\/g, '/'), line: Number.parseInt(m[2], 10), text: m[3] });
    if (matches.length >= cap) return { matches, truncated: true };
  }
  return { matches, truncated: false };
}
