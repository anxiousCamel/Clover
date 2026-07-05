/**
 * knowledge/ — Knowledge Base Department (FASE 1). Testa os motores puros
 * (frontmatter, BM25) e as 10 tools via handler contra workspace temporário:
 * ciclo de vida (save→update→tag→link→delete), busca estruturada vs ranqueada,
 * persistência md+sqlite (reopen), reconciliação (compact) com edição manual
 * de .md e arquivo apagado.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolInvocation, ToolResult } from '@clover/contracts';

import {
  compactMemoryTool,
  deleteMemoryTool,
  linkMemoriesTool,
  listMemoriesTool,
  memoryStatsTool,
  queryMemoryTool,
  saveMemoryTool,
  semanticSearchTool,
  tagMemoryTool,
  updateMemoryTool,
} from '../src/index.js';
import { parseMemory, serializeMemory, slugify } from '../src/knowledge/markdown.js';
import { rankDocuments, tokenize } from '../src/knowledge/rank.js';

let dir: string;

function ctx(): ToolInvocation {
  return {
    taskId: 't', traceId: 'tr', workspacePath: dir,
    token: { id: 'k', taskId: 't', caps: [{ kind: 'fs.write', pathGlob: '**' }], issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sig: 't' },
    emit: () => {},
  };
}

async function run(tool: { handler: (a: unknown, c: ToolInvocation) => Promise<unknown> }, args: unknown = {}): Promise<ToolResult> {
  return (await tool.handler(args, ctx())) as ToolResult;
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'clover-kb-')); });
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

// ===========================================================================
// Motores puros
// ===========================================================================

describe('knowledge/ markdown (frontmatter)', () => {
  it('serialize → parse é identidade', () => {
    const doc = {
      id: 'como-buildar', title: 'Como buildar', tags: ['build', 'ci'], links: ['outra-memoria'],
      createdAt: 111, updatedAt: 222, content: 'Rodar `pnpm build`.\n\nDetalhe: usa tsc --build.',
    };
    const round = parseMemory(serializeMemory(doc));
    expect(round).toEqual(doc);
  });

  it('parse rejeita formato inválido', () => {
    expect(parseMemory('sem frontmatter')).toBeNull();
    expect(parseMemory('---\nid: x\nsem fechamento')).toBeNull();
  });

  it('slugify normaliza acentos e caracteres especiais', () => {
    expect(slugify('Configuração do Sandbox!')).toBe('configuracao-do-sandbox');
  });
});

describe('knowledge/ rank (BM25)', () => {
  const docs = [
    { id: 'git', text: 'como usar git rebase e git commit no fluxo' },
    { id: 'build', text: 'processo de build com tsc e pnpm no monorepo' },
    { id: 'sandbox', text: 'sandbox tier 3 executa processos isolados' },
  ];

  it('ranqueia por relevância; termo raro pesa mais (IDF)', () => {
    const r = rankDocuments('git rebase', docs, 10);
    expect(r[0]?.id).toBe('git');
    expect(r.every((x) => x.score > 0)).toBe(true);
  });

  it('query sem match → vazio; determinístico em empate', () => {
    expect(rankDocuments('kubernetes', docs, 10)).toEqual([]);
    const tie = rankDocuments('processo', [
      { id: 'b', text: 'processo x' },
      { id: 'a', text: 'processo x' },
    ], 10);
    expect(tie.map((t) => t.id)).toEqual(['a', 'b']); // empate → id asc
  });

  it('tokenize remove acentos e termos curtos', () => {
    expect(tokenize('Configuração é RÁPIDA! a')).toEqual(['configuracao', 'rapida']);
  });
});

// ===========================================================================
// Tools (ciclo de vida completo)
// ===========================================================================

describe('knowledge/ tools', () => {
  it('save cria .md legível + entrada no índice; id = slug', async () => {
    const res = await run(saveMemoryTool, { title: 'Como Buildar o OS', content: 'pnpm run build:os', tags: ['build'] });
    expect(res.success).toBe(true);
    const out = res.output as { id: string; tags: string[] };
    expect(out.id).toBe('como-buildar-o-os');
    const md = readFileSync(join(dir, '.clover/knowledge/como-buildar-o-os.md'), 'utf8');
    expect(md).toContain('title: Como Buildar o OS');
    expect(md).toContain('pnpm run build:os');
  });

  it('colisão de título → sufixo -2', async () => {
    await run(saveMemoryTool, { title: 'Nota', content: 'primeira' });
    const res2 = await run(saveMemoryTool, { title: 'Nota', content: 'segunda' });
    expect((res2.output as { id: string }).id).toBe('nota-2');
  });

  it('update altera conteúdo; erro estruturado p/ id inexistente', async () => {
    await run(saveMemoryTool, { title: 'Nota', content: 'v1' });
    const up = await run(updateMemoryTool, { id: 'nota', content: 'v2' });
    expect((up.output as { content: string }).content).toBe('v2');
    const missing = await run(updateMemoryTool, { id: 'nao-existe', content: 'x' });
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('não existe');
  });

  it('persistência: base sobrevive reopen (novo handler = nova store)', async () => {
    await run(saveMemoryTool, { title: 'Durável', content: 'sobrevive reopen' });
    const list = await run(listMemoriesTool);
    expect((list.output as { total: number }).total).toBe(1);
  });

  it('query_memory (LIKE/tag) vs semantic_search (BM25 ranqueado)', async () => {
    await run(saveMemoryTool, { title: 'Fluxo Git', content: 'rebase, commit e restore no fluxo git', tags: ['git'] });
    await run(saveMemoryTool, { title: 'Build', content: 'tsc build monorepo', tags: ['build'] });

    const q = await run(queryMemoryTool, { text: 'rebase' });
    expect((q.output as { total: number }).total).toBe(1);
    const byTag = await run(queryMemoryTool, { tag: 'build' });
    expect((byTag.output as { results: Array<{ id: string }> }).results[0]?.id).toBe('build');

    const sem = await run(semanticSearchTool, { query: 'git rebase' });
    const semOut = sem.output as { results: Array<{ id: string; score: number }>; engine: string };
    expect(semOut.engine).toBe('bm25');
    expect(semOut.results[0]?.id).toBe('fluxo-git');
    expect(semOut.results[0]!.score).toBeGreaterThan(0);
  });

  it('tag_memory adiciona/remove; memory_stats agrega histograma', async () => {
    await run(saveMemoryTool, { title: 'N1', content: 'c', tags: ['a'] });
    await run(tagMemoryTool, { id: 'n1', add: ['b', 'c'], remove: ['a'] });
    const doc = await run(queryMemoryTool, { text: 'c' });
    expect((doc.output as { results: Array<{ tags: string[] }> }).results[0]?.tags).toEqual(['b', 'c']);

    const stats = await run(memoryStatsTool);
    const s = stats.output as { memories: number; tags: Array<{ tag: string }> };
    expect(s.memories).toBe(1);
    expect(s.tags.map((t) => t.tag).sort()).toEqual(['b', 'c']);
  });

  it('link_memories bidirecional escreve links nos dois .md', async () => {
    await run(saveMemoryTool, { title: 'A', content: 'a' });
    await run(saveMemoryTool, { title: 'B', content: 'b' });
    const res = await run(linkMemoriesTool, { from: 'a', to: 'b', bidirectional: true });
    const out = res.output as { fromLinks: string[]; toLinks: string[] };
    expect(out.fromLinks).toEqual(['b']);
    expect(out.toLinks).toEqual(['a']);
    expect(readFileSync(join(dir, '.clover/knowledge/a.md'), 'utf8')).toContain('links: b');
  });

  it('delete remove .md + índice + links reversos; erro p/ inexistente', async () => {
    await run(saveMemoryTool, { title: 'A', content: 'a' });
    await run(saveMemoryTool, { title: 'B', content: 'b' });
    await run(linkMemoriesTool, { from: 'a', to: 'b' });

    const del = await run(deleteMemoryTool, { id: 'b' });
    expect((del.output as { deleted: boolean }).deleted).toBe(true);
    expect(existsSync(join(dir, '.clover/knowledge/b.md'))).toBe(false);
    // Link a→b morreu junto (poda no delete).
    const a = await run(queryMemoryTool, { text: 'a' });
    expect((a.output as { results: Array<{ links: string[] }> }).results[0]?.links).toEqual([]);

    expect((await run(deleteMemoryTool, { id: 'b' })).success).toBe(false);
  });

  it('compact_memory reconcilia: .md editado à mão entra, órfão sai, link pendurado é podado', async () => {
    await run(saveMemoryTool, { title: 'Viva', content: 'original' });
    await run(saveMemoryTool, { title: 'Morta', content: 'vai sumir' });
    await run(linkMemoriesTool, { from: 'viva', to: 'morta' });

    // Edição manual do .md (humano) + remoção manual de outro .md.
    const vivaPath = join(dir, '.clover/knowledge/viva.md');
    const viva = parseMemory(readFileSync(vivaPath, 'utf8'))!;
    writeFileSync(vivaPath, serializeMemory({ ...viva, content: 'EDITADO À MÃO', updatedAt: viva.updatedAt + 1 }));
    rmSync(join(dir, '.clover/knowledge/morta.md'));

    const res = await run(compactMemoryTool);
    const out = res.output as { indexed: number; removed: number; danglingLinksPruned: number };
    expect(out.indexed).toBeGreaterThanOrEqual(1); // viva reindexada
    expect(out.removed).toBe(1); // morta saiu do índice
    expect(out.danglingLinksPruned).toBe(1); // viva→morta podado

    const q = await run(queryMemoryTool, { text: 'EDITADO' });
    expect((q.output as { total: number }).total).toBe(1);
    const listed = await run(listMemoriesTool);
    expect((listed.output as { total: number }).total).toBe(1);
  });
});
