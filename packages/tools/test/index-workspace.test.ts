/**
 * index/ — indexer incremental + tools (workspace_index, find_references,
 * rename_symbol). Cria um workspace temporário com arquivos TS reais, indexa,
 * consulta e valida o comportamento incremental (mtime) e o preview de rename.
 */

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolInvocation, ToolResult } from '@clover/contracts';

import { findReferencesTool, renameSymbolTool, workspaceIndexTool } from '../src/index.js';
import { WorkspaceIndexStore } from '../src/index/store.js';
import { refreshIndex } from '../src/index/indexer.js';

let dir: string;

function ctx(): ToolInvocation {
  return {
    taskId: 't', traceId: 'tr', workspacePath: dir,
    token: { id: 'k', taskId: 't', caps: [{ kind: 'fs.read', pathGlob: '**' }], issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sig: 't' },
    emit: () => {},
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clover-ws-'));
  writeFileSync(join(dir, 'util.ts'), 'export function greet(n: string): string { return n; }\nexport const PI = 3.14;\n');
  writeFileSync(join(dir, 'main.ts'), "import { greet } from './util.js';\nexport class App { run() { return greet('x'); } }\n");
});
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('index/ workspace_index (tool)', () => {
  it('indexa arquivos TS e reporta stats', async () => {
    const res = (await workspaceIndexTool.handler({}, ctx())) as ToolResult;
    expect(res.success).toBe(true);
    const out = res.output as { indexed: number; files: number; symbols: number; imports: number; dbPath: string };
    expect(out.indexed).toBe(2);
    expect(out.files).toBe(2);
    expect(out.symbols).toBeGreaterThanOrEqual(3); // greet, PI, App, run
    expect(out.imports).toBe(1);
    expect(out.dbPath).toBe('.clover/index.db');
  });

  it('2ª indexação sem mudança → tudo skipped (incremental)', async () => {
    await workspaceIndexTool.handler({}, ctx());
    const res = (await workspaceIndexTool.handler({}, ctx())) as ToolResult;
    const out = res.output as { indexed: number; skipped: number };
    expect(out.indexed).toBe(0);
    expect(out.skipped).toBe(2);
  });
});

describe('index/ refreshIndex (incremental via mtime)', () => {
  it('reindexa só o arquivo alterado; remove o deletado', async () => {
    const store = await WorkspaceIndexStore.open(':memory:');
    expect(refreshIndex(store, dir)).toMatchObject({ indexed: 2, skipped: 0, removed: 0 });

    // Sem mudança → skip total.
    expect(refreshIndex(store, dir)).toMatchObject({ indexed: 0, skipped: 2, removed: 0 });

    // Altera util.ts (avança mtime explicitamente p/ evitar resolução grosseira).
    writeFileSync(join(dir, 'util.ts'), 'export function greet(n: string): string { return n + "!"; }\n');
    const future = Date.now() / 1000 + 10;
    utimesSync(join(dir, 'util.ts'), future, future);
    expect(refreshIndex(store, dir)).toMatchObject({ indexed: 1, skipped: 1, removed: 0 });

    // Remove main.ts → sai do índice.
    rmSync(join(dir, 'main.ts'));
    expect(refreshIndex(store, dir)).toMatchObject({ indexed: 0, skipped: 1, removed: 1 });
    store.close();
  });
});

describe('index/ find_references (tool)', () => {
  it('acha definição + site de import de um símbolo', async () => {
    const res = (await findReferencesTool.handler({ name: 'greet' }, ctx())) as ToolResult;
    expect(res.success).toBe(true);
    const out = res.output as { found: boolean; definitions: Array<{ path: string; kind: string }>; importSites: Array<{ path: string }> };
    expect(out.found).toBe(true);
    expect(out.definitions.some((d) => d.path === 'util.ts' && d.kind === 'function')).toBe(true);
    expect(out.importSites.map((i) => i.path)).toContain('main.ts');
  });

  it('símbolo inexistente → found=false, listas vazias', async () => {
    const res = (await findReferencesTool.handler({ name: 'Inexistente' }, ctx())) as ToolResult;
    const out = res.output as { found: boolean; definitions: unknown[]; importSites: unknown[] };
    expect(out.found).toBe(false);
    expect(out.definitions).toEqual([]);
    expect(out.importSites).toEqual([]);
  });
});

describe('index/ rename_symbol (dry-run preview)', () => {
  it('lista sites que mudariam e NÃO aplica nada', async () => {
    const before = 'export function greet(n: string): string { return n; }\nexport const PI = 3.14;\n';
    const res = (await renameSymbolTool.handler({ name: 'greet', newName: 'salute' }, ctx())) as ToolResult;
    expect(res.success).toBe(true);
    const out = res.output as { applied: boolean; wouldChange: Array<{ path: string; site: string }> };
    expect(out.applied).toBe(false);
    expect(out.wouldChange.some((c) => c.path === 'util.ts' && c.site === 'declaration')).toBe(true);
    expect(out.wouldChange.some((c) => c.path === 'main.ts' && c.site === 'import')).toBe(true);
    // Arquivo NÃO foi tocado (preview puro).
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(dir, 'util.ts'), 'utf8')).toBe(before);
  });
});
