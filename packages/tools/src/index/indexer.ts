/**
 * index/indexer — Varredura incremental do workspace → Workspace Index.
 *
 * Reusa o parser do `@clover/ast-index` (TS Compiler API) para extrair símbolos
 * e imports; persiste no `WorkspaceIndexStore` (SQLite). **Incremental:** um
 * arquivo só é reparseado se `mtime`/`size` mudaram desde a última indexação
 * (evita reprocessar a AST do projeto todo). Arquivos sumidos são removidos.
 *
 * SRP: varredura + diff incremental. Armazenamento fica no store; extração de
 * AST no ast-index.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { TypeScriptAstParser } from '@clover/ast-index';

import { resolveInWorkspace } from '../sys/fs.js';
import { WorkspaceIndexStore, type IndexedImport, type IndexedSymbol } from './store.js';
import type { ToolInvocation } from '@clover/contracts';

/** Diretórios nunca indexados: VCS, deps e SAÍDAS de build (evita duplicar src). */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.clover', 'coverage']);
/** Teto de tamanho por arquivo (protege memória; fontes reais ficam bem abaixo). */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Caminho canônico do índice persistido dentro do workspace (gitignored: `*.db`). */
export const INDEX_DB_REL = '.clover/index.db';

const parser = new TypeScriptAstParser();

export interface RefreshResult {
  indexed: number;
  skipped: number;
  removed: number;
}

/** Walk iterativo (sem recursão de pilha) sob `absRoot`, pulando `SKIP_DIRS`. */
export function* walkFiles(absRoot: string): Generator<string> {
  const stack: string[] = [absRoot];
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
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        yield full;
      }
    }
  }
}

/**
 * Reindexa incrementalmente `absRoot` no `store` (sem persistir — o caller
 * decide quando `persist()`). Retorna contadores da passada.
 */
export function refreshIndex(store: WorkspaceIndexStore, absRoot: string): RefreshResult {
  let indexed = 0;
  let skipped = 0;
  let removed = 0;
  const seen = new Set<string>();

  for (const abs of walkFiles(absRoot)) {
    if (!parser.canParse(abs)) continue;
    const rel = relative(absRoot, abs).replace(/\\/g, '/');
    seen.add(rel);

    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    const mtime = Math.floor(st.mtimeMs);
    const size = st.size;
    if (size > MAX_FILE_BYTES) continue;

    // Incremental: mtime + size iguais → nada mudou, pula o parse.
    const prev = store.getFileMeta(rel);
    if (prev && prev.mtime === mtime && prev.size === size) {
      skipped++;
      continue;
    }

    let source: string;
    try {
      source = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const ast = parser.parse(rel, source);
    const symbols: IndexedSymbol[] = ast.symbols.map((s) => ({
      path: rel,
      name: s.name,
      kind: s.kind,
      line: s.line,
      endLine: s.endLine ?? null,
      exported: s.exported,
      container: s.container ?? null,
    }));
    const imports: IndexedImport[] = ast.imports.map((i) => ({
      path: rel,
      module: i.from,
      names: i.names.join(','),
      line: i.line,
    }));
    store.upsertFile({ path: rel, mtime, size }, symbols, imports);
    indexed++;
  }

  // Arquivos que sumiram do disco saem do índice.
  for (const rel of store.allFilePaths()) {
    if (!seen.has(rel)) {
      store.removeFile(rel);
      removed++;
    }
  }

  return { indexed, skipped, removed };
}

export interface EnsureIndexResult {
  store: WorkspaceIndexStore;
  refresh: RefreshResult;
  dbPath: string;
}

/**
 * Abre o índice persistido do workspace, reindexa incrementalmente e persiste.
 * Base compartilhada por `workspace_index`, `find_references` e `rename_symbol`.
 * O caller é responsável por `store.close()`.
 */
export async function ensureIndex(ctx: ToolInvocation): Promise<EnsureIndexResult> {
  const dbPath = resolveInWorkspace(ctx, INDEX_DB_REL);
  const absRoot = resolveInWorkspace(ctx, '.');
  const store = await WorkspaceIndexStore.open(dbPath);
  const refresh = refreshIndex(store, absRoot);
  store.persist();
  return { store, refresh, dbPath };
}
