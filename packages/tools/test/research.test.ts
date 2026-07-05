/**
 * research/ — Deep Research Department (FASE 3). Fetcher FAKE injetado via
 * `makeResearchTools` (zero rede; determinístico) — o caminho vivo usa o mesmo
 * código com o fetch real do Node. Cobre: HTML→texto, cache (hit/miss/idade/
 * degradação em falha de rede), timeout real, OpenAPI/JSON Schema, README,
 * busca BM25 no cache e sumarização extrativa.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolInvocation, ToolResult } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';

import { makeResearchTools, type FetchLike } from '../src/research/index.js';
import { extractTitle, htmlToText } from '../src/research/html.js';
import { extractHeadings, summarizeDocument } from '../src/research/summarize.js';

let dir: string;

function ctx(): ToolInvocation {
  return {
    taskId: 't', traceId: 'tr', workspacePath: dir,
    token: { id: 'k', taskId: 't', caps: [{ kind: 'net', hostAllow: ['*'] }], issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sig: 't' },
    emit: () => {},
  };
}

const HTML_PAGE = `<!doctype html><html><head><title>Guia do Sandbox</title><style>body{color:red}</style></head>
<body><script>alert(1)</script><h1>Sandbox Tier 3</h1><p>Processos &amp; isolamento reais.</p>
<p>Segundo par&aacute;grafo.</p></body></html>`;

const README_MD = `# CloverOS\n\nAssistente local.\n\n## Instalação\n\nRode \`pnpm install\` na raiz.\n\n\`\`\`bash\npnpm install\n\`\`\`\n\n## Uso\n\nVeja [docs](https://example.com/docs).\n`;

const OPENAPI = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'Pets API', version: '2.0.0' },
  paths: {
    '/pets': { get: { summary: 'List pets' }, post: { summary: 'Create pet' } },
    '/pets/{id}': { get: { summary: 'Get pet' } },
  },
});

const JSON_SCHEMA = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.com/pet.json',
  title: 'Pet',
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string' }, age: { type: 'integer' } },
});

/** Fetcher fake: rotas fixas + contador de chamadas + modo de falha. */
function makeFakeFetcher(): { fetcher: FetchLike; calls: string[]; fail: { on: boolean } } {
  const calls: string[] = [];
  const fail = { on: false };
  const routes: Record<string, { body: string; type: string; status?: number }> = {
    'https://docs.example.com/sandbox': { body: HTML_PAGE, type: 'text/html; charset=utf-8' },
    'https://raw.githubusercontent.com/clover/os/HEAD/README.md': { body: README_MD, type: 'text/plain' },
    'https://api.example.com/openapi.json': { body: OPENAPI, type: 'application/json' },
    'https://example.com/pet.schema.json': { body: JSON_SCHEMA, type: 'application/json' },
    'https://example.com/missing': { body: 'nope', type: 'text/plain', status: 404 },
  };
  const fetcher: FetchLike = async (url) => {
    calls.push(url);
    if (fail.on) throw new Error('ECONNREFUSED (fake)');
    const r = routes[url];
    if (!r) return { status: 404, headers: { get: () => null }, text: async () => 'not found' };
    return { status: r.status ?? 200, headers: { get: (n) => (n.toLowerCase() === 'content-type' ? r.type : null) }, text: async () => r.body };
  };
  return { fetcher, calls, fail };
}

function toolByName(tools: LocalTool[], name: string): LocalTool {
  const t = tools.find((x) => x.descriptor.name === name);
  if (!t) throw new Error(`tool ${name} não encontrada`);
  return t;
}

async function call(tool: LocalTool, args: unknown): Promise<ToolResult> {
  return (await tool.handler(args, ctx())) as ToolResult;
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'clover-research-')); });
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

// ===========================================================================
// Motores puros
// ===========================================================================

describe('research/ html (puro)', () => {
  it('extrai título e converte HTML em texto limpo (sem script/style, entidades ok)', () => {
    expect(extractTitle(HTML_PAGE)).toBe('Guia do Sandbox');
    const text = htmlToText(HTML_PAGE);
    expect(text).toContain('Sandbox Tier 3');
    expect(text).toContain('Processos & isolamento reais.');
    expect(text).toContain('Segundo parágrafo.');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });
});

describe('research/ summarize (puro)', () => {
  it('headings ignoram cercas de código; sumário extrai 1º parágrafo por seção', () => {
    const h = extractHeadings(README_MD);
    expect(h.map((x) => x.text)).toEqual(['CloverOS', 'Instalação', 'Uso']);

    const s = summarizeDocument(README_MD);
    expect(s.sections.find((x) => x.heading === 'Instalação')?.firstParagraph).toContain('pnpm install');
    expect(s.codeBlockCount).toBe(1);
    expect(s.linkCount).toBe(1);
    expect(s.wordCount).toBeGreaterThan(10);
  });
});

// ===========================================================================
// Tools com fetcher fake
// ===========================================================================

describe('research/ tools (fetcher injetado)', () => {
  it('fetch_documentation converte HTML, cacheia e serve do cache na 2ª chamada', async () => {
    const { fetcher, calls } = makeFakeFetcher();
    const tools = makeResearchTools(fetcher);
    const t = toolByName(tools, 'fetch_documentation');

    const r1 = await call(t, { url: 'https://docs.example.com/sandbox' });
    expect(r1.success).toBe(true);
    const o1 = r1.output as { title: string; text: string; fromCache: boolean };
    expect(o1.title).toBe('Guia do Sandbox');
    expect(o1.text).toContain('isolamento reais');
    expect(o1.fromCache).toBe(false);

    const r2 = await call(t, { url: 'https://docs.example.com/sandbox' });
    expect((r2.output as { fromCache: boolean }).fromCache).toBe(true);
    expect(calls).toHaveLength(1); // rede tocada UMA vez
  });

  it('maxAgeMs=0 força re-busca; falha de rede degrada para cache velho', async () => {
    const { fetcher, calls, fail } = makeFakeFetcher();
    const t = toolByName(makeResearchTools(fetcher), 'fetch_documentation');
    await call(t, { url: 'https://docs.example.com/sandbox' });

    await call(t, { url: 'https://docs.example.com/sandbox', maxAgeMs: 0 });
    expect(calls).toHaveLength(2); // re-buscou

    fail.on = true;
    const r = await call(t, { url: 'https://docs.example.com/sandbox', maxAgeMs: 0 });
    expect(r.success).toBe(true); // degradação graciosa
    expect((r.output as { fromCache: boolean }).fromCache).toBe(true);
  });

  it('HTTP 404 sem cache → { success:false } estruturado', async () => {
    const { fetcher } = makeFakeFetcher();
    const t = toolByName(makeResearchTools(fetcher), 'fetch_documentation');
    const r = await call(t, { url: 'https://example.com/missing' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('HTTP 404');
  });

  it('timeout real: fetcher lento aborta e retorna erro estruturado', async () => {
    const slow: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const t = toolByName(makeResearchTools(slow), 'fetch_documentation');
    const r = await call(t, { url: 'https://docs.example.com/sandbox', timeoutMs: 100 });
    expect(r.success).toBe(false);
    expect(r.error).toContain('falhou');
  });

  it('fetch_github_readme monta a URL raw e extrai headings', async () => {
    const { fetcher } = makeFakeFetcher();
    const t = toolByName(makeResearchTools(fetcher), 'fetch_github_readme');
    const r = await call(t, { owner: 'clover', repo: 'os' });
    const out = r.output as { repository: string; headings: Array<{ text: string }> };
    expect(out.repository).toBe('clover/os');
    expect(out.headings.map((h) => h.text)).toContain('Instalação');
  });

  it('fetch_openapi extrai operações ordenadas; JSON inválido → erro', async () => {
    const { fetcher } = makeFakeFetcher();
    const tools = makeResearchTools(fetcher);
    const r = await call(toolByName(tools, 'fetch_openapi'), { url: 'https://api.example.com/openapi.json' });
    const out = r.output as { title: string; pathCount: number; operations: Array<{ method: string; path: string }> };
    expect(out.title).toBe('Pets API');
    expect(out.pathCount).toBe(2);
    expect(out.operations).toEqual([
      { method: 'GET', path: '/pets', summary: 'List pets' },
      { method: 'POST', path: '/pets', summary: 'Create pet' },
      { method: 'GET', path: '/pets/{id}', summary: 'Get pet' },
    ]);

    const bad = await call(toolByName(tools, 'fetch_openapi'), { url: 'https://docs.example.com/sandbox' });
    expect(bad.success).toBe(false);
  });

  it('fetch_json_schema extrai propriedades de topo', async () => {
    const { fetcher } = makeFakeFetcher();
    const r = await call(toolByName(makeResearchTools(fetcher), 'fetch_json_schema'), { url: 'https://example.com/pet.schema.json' });
    const out = r.output as { title: string; required: string[]; properties: Array<{ name: string; type: string }> };
    expect(out.title).toBe('Pet');
    expect(out.required).toEqual(['name']);
    expect(out.properties).toEqual([
      { name: 'age', type: 'integer' },
      { name: 'name', type: 'string' },
    ]);
  });

  it('cache_documentation semeia; search_documentation ranqueia BM25 no cache', async () => {
    const { fetcher } = makeFakeFetcher();
    const tools = makeResearchTools(fetcher);
    await call(toolByName(tools, 'cache_documentation'), {
      url: 'https://example.com/git-doc', content: 'git rebase e commit no fluxo de trabalho git',
    });
    await call(toolByName(tools, 'cache_documentation'), {
      url: 'https://example.com/build-doc', content: 'build com tsc no monorepo pnpm',
    });

    const r = await call(toolByName(tools, 'search_documentation'), { query: 'git rebase' });
    const out = r.output as { results: Array<{ url: string; score: number }>; corpusSize: number; engine: string };
    expect(out.engine).toBe('bm25-local-cache');
    expect(out.corpusSize).toBe(2);
    expect(out.results[0]?.url).toBe('https://example.com/git-doc');
  });

  it('summarize_documentation usa o cache (sem rede quando já buscado)', async () => {
    const { fetcher, calls } = makeFakeFetcher();
    const tools = makeResearchTools(fetcher);
    await call(toolByName(tools, 'fetch_github_readme'), { owner: 'clover', repo: 'os' });

    const r = await call(toolByName(tools, 'summarize_documentation'), {
      url: 'https://raw.githubusercontent.com/clover/os/HEAD/README.md',
    });
    expect(r.success).toBe(true);
    const out = r.output as { fromCache: boolean; sections: Array<{ heading: string }> };
    expect(out.fromCache).toBe(true);
    expect(out.sections.map((s) => s.heading)).toContain('Uso');
    expect(calls).toHaveLength(1); // só o fetch do README; summarize não tocou rede
  });
});
