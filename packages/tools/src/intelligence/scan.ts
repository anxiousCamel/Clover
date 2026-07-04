/**
 * intelligence/scan — Scanners de convenção e conteúdo (SRP: extração pura de
 * fatos de arquivos/paths; sem Zod, I/O mínimo e explícito).
 *
 * Reusa `walkSearch` (dev/search) para varredura de marcadores — mesma semântica
 * de skip (.git/node_modules) — com pós-filtro para saídas de build.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { walkSearch, type CodeMatch } from '../dev/search.js';

/** Saídas de build/caches filtradas dos resultados (walkSearch só pula .git/node_modules). */
const NOISE_RE = /(^|\/)(dist|\.clover|coverage|build|out)\//;

export interface MarkerHit {
  file: string;
  line: number;
  text: string;
}

/** Ocorrências de um marcador (TODO/FIXME/...) sob `root`, sem ruído de build. */
export function scanMarkers(root: string, marker: string, cap: number): { hits: MarkerHit[]; truncated: boolean } {
  const res = walkSearch(root, root, marker, false, cap);
  const hits = res.matches
    .filter((m: CodeMatch) => !NOISE_RE.test(m.file))
    .map((m: CodeMatch) => ({ file: m.file, line: m.line, text: m.text.trim() }));
  return { hits, truncated: res.truncated };
}

export interface EnvVarUse {
  name: string;
  file: string;
  line: number;
}

const ENV_RE = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[['"]([^'"]+)['"]\])/g;

/** Usos de `process.env.X` / `process.env['X']` nos arquivos dados (paths relativos). */
export function scanEnvVars(absRoot: string, relFiles: string[]): EnvVarUse[] {
  const uses: EnvVarUse[] = [];
  for (const rel of relFiles) {
    let content: string;
    try {
      content = readFileSync(join(absRoot, rel), 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      ENV_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ENV_RE.exec(lines[i]!)) !== null) {
        const name = m[1] ?? m[2];
        if (name) uses.push({ name, file: rel, line: i + 1 });
      }
    }
  }
  return uses.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file) || a.line - b.line);
}

export interface PackageManifest {
  /** Path relativo do package.json. */
  path: string;
  name: string | null;
  main: string | null;
  bin: string[];
  scripts: Record<string, string>;
}

const WALK_SKIP = new Set(['.git', 'node_modules', 'dist', '.clover', 'coverage']);

/** Localiza e parseia todos os package.json do workspace (skip build/deps). */
export function scanPackageManifests(absRoot: string): PackageManifest[] {
  const out: PackageManifest[] = [];
  const stack = [absRoot];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!WALK_SKIP.has(e.name)) stack.push(full);
        continue;
      }
      if (e.name !== 'package.json') continue;
      try {
        const parsed = JSON.parse(readFileSync(full, 'utf8')) as Record<string, unknown>;
        const bin = parsed.bin;
        out.push({
          path: relative(absRoot, full).replace(/\\/g, '/'),
          name: typeof parsed.name === 'string' ? parsed.name : null,
          main: typeof parsed.main === 'string' ? parsed.main : null,
          bin:
            typeof bin === 'string'
              ? [bin]
              : bin && typeof bin === 'object'
                ? Object.values(bin as Record<string, string>).filter((v) => typeof v === 'string')
                : [],
          scripts:
            parsed.scripts && typeof parsed.scripts === 'object'
              ? Object.fromEntries(
                  Object.entries(parsed.scripts as Record<string, unknown>).filter(
                    (kv): kv is [string, string] => typeof kv[1] === 'string',
                  ),
                )
              : {},
        });
      } catch {
        continue; // JSON inválido → ignora (degradação graciosa)
      }
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Arquivos de configuração por convenção sob `absRoot` (walk, skip build/deps). */
export function scanConfigFiles(absRoot: string): string[] {
  const files: string[] = [];
  const stack = [absRoot];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!WALK_SKIP.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        const rel = relative(absRoot, full).replace(/\\/g, '/');
        if (CONFIG_FILE_RE.test(rel)) files.push(rel);
      }
    }
  }
  return files.sort();
}

/** Convenções de arquivo de teste. */
export const TEST_FILE_RE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)__tests__\//;

/** Convenções de arquivo de configuração (nome-base). */
export const CONFIG_FILE_RE =
  /(^|\/)((tsconfig[^/]*\.json)|([^/]+\.config\.[cm]?[jt]s)|(\.[a-z]+rc(\.[a-z]+)?))$/;

/** Convenções de entrypoint por nome (além de package.json main/bin). */
export const ENTRYPOINT_NAME_RE = /(^|\/)(index|main|cli|app|server|demo)\.[cm]?[jt]sx?$/;
