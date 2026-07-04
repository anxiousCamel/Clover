/**
 * index/store — prova que o sql.js (WASM) inicializa e persiste SOB VITEST
 * (transform/resolução diferentes do `node` puro) + round-trip em disco.
 * Este é o ponto de risco de integração do Workspace Index; validado antes do
 * indexer e das tools.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceIndexStore, type IndexedImport, type IndexedSymbol } from '../src/index/store.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'clover-idx-')); });
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

const sym = (over: Partial<IndexedSymbol>): IndexedSymbol => ({
  path: 'a.ts', name: 'x', kind: 'function', line: 1, endLine: null, exported: true, container: null, ...over,
});
const imp = (over: Partial<IndexedImport>): IndexedImport => ({
  path: 'a.ts', module: './b', names: 'foo', line: 1, ...over,
});

describe('WorkspaceIndexStore (sql.js sob vitest)', () => {
  it('inicializa em :memory:, grava e consulta determinístico', async () => {
    const store = await WorkspaceIndexStore.open(':memory:');
    store.upsertFile(
      { path: 'a.ts', mtime: 100, size: 10 },
      [sym({ name: 'greet', line: 5 }), sym({ name: 'greet', kind: 'method', line: 2, container: 'C' })],
      [imp({ module: 'node:fs', names: 'readFileSync', line: 1 })],
    );
    // ORDER BY path,line → line 2 antes de line 5.
    const found = store.symbolsByName('greet');
    expect(found.map((s) => s.line)).toEqual([2, 5]);
    expect(found[0]?.container).toBe('C');
    expect(store.stats()).toEqual({ files: 1, symbols: 2, imports: 1 });
    store.close();
  });

  it('upsert é idempotente por path (substitui, não duplica)', async () => {
    const store = await WorkspaceIndexStore.open(':memory:');
    store.upsertFile({ path: 'a.ts', mtime: 1, size: 1 }, [sym({ name: 'v1' })], []);
    store.upsertFile({ path: 'a.ts', mtime: 2, size: 2 }, [sym({ name: 'v2' })], []);
    expect(store.symbolsByName('v1')).toHaveLength(0);
    expect(store.symbolsByName('v2')).toHaveLength(1);
    expect(store.getFileMeta('a.ts')?.mtime).toBe(2);
    store.close();
  });

  it('removeFile limpa arquivo, símbolos e imports', async () => {
    const store = await WorkspaceIndexStore.open(':memory:');
    store.upsertFile({ path: 'a.ts', mtime: 1, size: 1 }, [sym({ name: 'gone' })], [imp({})]);
    store.removeFile('a.ts');
    expect(store.stats()).toEqual({ files: 0, symbols: 0, imports: 0 });
    store.close();
  });

  it('importSitesReferencing casa nome exato na lista de imports', async () => {
    const store = await WorkspaceIndexStore.open(':memory:');
    store.upsertFile({ path: 'a.ts', mtime: 1, size: 1 }, [], [imp({ names: 'foo, bar', line: 3 })]);
    store.upsertFile({ path: 'b.ts', mtime: 1, size: 1 }, [], [imp({ path: 'b.ts', names: 'baz', line: 1 })]);
    expect(store.importSitesReferencing('bar').map((i) => i.path)).toEqual(['a.ts']);
    expect(store.importSitesReferencing('nope')).toHaveLength(0);
    store.close();
  });

  it('round-trip em disco: persist → reopen mantém os dados', async () => {
    const dbPath = join(dir, '.clover', 'index.db');
    const s1 = await WorkspaceIndexStore.open(dbPath);
    s1.upsertFile({ path: 'a.ts', mtime: 42, size: 7 }, [sym({ name: 'persisted', line: 9 })], []);
    s1.persist();
    s1.close();

    const s2 = await WorkspaceIndexStore.open(dbPath);
    const found = s2.symbolsByName('persisted');
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(9);
    expect(s2.getFileMeta('a.ts')?.mtime).toBe(42);
    s2.close();
  });
});
