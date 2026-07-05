/**
 * Regressão de SELEÇÃO de tools — incidente real do REPL:
 *
 *   "consegue listar os arquivos da area de trabalho"
 *   → Autorizar git_clean (destructive)? (s/N)
 *
 * Causa-raiz dupla: (1) não existia tool de listagem (nenhuma affordance
 * correta); (2) a descrição de git_clean continha as próprias palavras da
 * query ("listar", "arquivos") — a anti-instrução VIRAVA isca lexical.
 *
 * Contrato testado contra o REGISTRO REAL (`cloverTools`) + o scorer REAL
 * (`LexicalToolSearch`): a query do incidente seleciona `list_files` no topo e
 * NUNCA seleciona git_clean/git_restore.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ToolInvocation, ToolResult } from '@clover/contracts';
import { LexicalToolSearch } from '@clover/tool-search';

import { cloverTools, listFilesTool } from '../src/index.js';

const descriptors = cloverTools.map((t) => t.descriptor);
const search = new LexicalToolSearch(descriptors);

const INCIDENT_QUERY = 'consegue listar os arquivos da area de trabalho';

describe('seleção de tools — regressão do incidente git_clean', () => {
  it('query do incidente → tool de listagem (read) no topo; nada destrutivo', () => {
    const top = search.find(INCIDENT_QUERY, 8);
    // list_files ou list_directory são respostas corretas; o bug era git_clean vencer.
    expect(['list_files', 'list_directory']).toContain(top[0]?.name);
    expect(top[0]?.intent ?? 'read').toBe('read');
  });

  it('query do incidente → NENHUMA tool destrutiva no top-8', () => {
    const top = search.find(INCIDENT_QUERY, 8).map((t) => t.name);
    expect(top).not.toContain('git_clean');
    expect(top).not.toContain('git_restore');
    expect(top).not.toContain('delete_memory');
  });

  it('variações de exploração também caem em tools read', () => {
    for (const q of ['mostrar arquivos da pasta', 'ver os arquivos do projeto', 'explorar diretório']) {
      const top = search.find(q, 5);
      expect(top.length).toBeGreaterThan(0);
      for (const t of top) expect(t.intent ?? 'read').not.toBe('destructive');
    }
  });

  it('pedido EXPLÍCITO de desfazer/reverter ainda encontra as destrutivas', () => {
    const top = search.find('descartar alterações não commitadas e reverter mudanças', 8).map((t) => t.name);
    expect(top).toContain('git_restore');
  });

  it('descrições de git_clean/git_restore não contêm palavras-isca de listagem', () => {
    for (const name of ['git_clean', 'git_restore']) {
      const d = descriptors.find((t) => t.name === name)!.description.toLowerCase();
      for (const bait of ['listar', 'explorar', 'arquivos da', 'area de trabalho']) {
        expect(d).not.toContain(bait);
      }
    }
  });
});

describe('list_files (tool real)', () => {
  let dir: string;

  function ctx(): ToolInvocation {
    return {
      taskId: 't', traceId: 'tr', workspacePath: dir,
      token: { id: 'k', taskId: 't', caps: [{ kind: 'fs.read', pathGlob: '**' }], issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sig: 't' },
      emit: () => {},
    };
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'clover-ls-'));
    writeFileSync(join(dir, 'readme.md'), 'oi\n');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'export {}\n');
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), '1\n');
  });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('lista o nível raiz com tipo e tamanho', async () => {
    const res = (await listFilesTool.handler({}, ctx())) as ToolResult;
    expect(res.success).toBe(true);
    const out = res.output as { entries: Array<{ name: string; type: string; size: number }> };
    const byName = new Map(out.entries.map((e) => [e.name, e]));
    expect(byName.get('readme.md')?.type).toBe('file');
    expect(byName.get('readme.md')!.size).toBeGreaterThan(0);
    expect(byName.get('src')?.type).toBe('dir');
  });

  it('recursive desce em src mas pula node_modules', async () => {
    const res = (await listFilesTool.handler({ recursive: true }, ctx())) as ToolResult;
    const out = res.output as { entries: Array<{ path: string }> };
    const paths = out.entries.map((e) => e.path);
    expect(paths).toContain('src/a.ts');
    expect(paths.some((p) => p.startsWith('node_modules/x'))).toBe(false);
  });

  it('path fora do workspace → { success:false }', async () => {
    const res = (await listFilesTool.handler({ path: '../fora' }, ctx())) as ToolResult;
    expect(res.success).toBe(false);
  });

  it('diretório inexistente → { success:false } estruturado', async () => {
    const res = (await listFilesTool.handler({ path: 'nao-existe' }, ctx())) as ToolResult;
    expect(res.success).toBe(false);
  });
});
