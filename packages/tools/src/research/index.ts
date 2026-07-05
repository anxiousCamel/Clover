/**
 * Namespace `research/` — Deep Research Department (FASE 3).
 *
 * Pesquisa externa REAL com fetcher **injetável** (`makeResearchTools(fetcher)`):
 * produção usa o `fetch` global do Node; testes injetam um fake determinístico
 * (mesmo precedente do OllamaProvider — caminho vivo real, teste sem rede).
 *
 * Primeiro departamento com capability `net`. Timeout REAL configurável por
 * chamada (`timeoutMs` → AbortController) — cancelamento de verdade, não campo
 * decorativo. Toda busca passa pelo DocCache (`.clover/research-cache/`):
 * `maxAgeMs` controla reuso; cache torna `search_documentation` e
 * `summarize_documentation` utilizáveis offline.
 *
 * HONESTO: `search_documentation` busca no CACHE local (BM25 — reuso do motor
 * do knowledge/), não é motor de busca web (não há API de search disponível).
 */

import type { CapabilityRequest, ToolInvocation } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';
import { z } from 'zod';

import { defineZodTool } from '../abi.js';
import { resolveInWorkspace } from '../sys/fs.js';
import { rankDocuments } from '../knowledge/rank.js';
import { DocCache, RESEARCH_CACHE_REL, cacheKey, type CacheEntry } from './cache.js';
import { extractTitle, htmlToText, looksLikeHtml } from './html.js';
import { extractHeadings, summarizeDocument } from './summarize.js';

/** Subconjunto estrutural do fetch global — o real satisfaz; testes fazem fake. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

const NET: CapabilityRequest[] = [{ kind: 'net' }, { kind: 'fs.read' }];
const READ_ONLY: CapabilityRequest[] = [{ kind: 'fs.read' }];

const MAX_BODY_BYTES = 512 * 1024;
const MAX_TEXT_CHARS = 50_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const UrlInput = z.string().url().describe('URL http(s).');
const TimeoutInput = z.number().int().min(100).max(120_000).optional().describe(`Timeout em ms (default ${DEFAULT_TIMEOUT_MS}).`);
const MaxAgeInput = z.number().int().min(0).optional().describe('Idade máx. do cache em ms (0 = sempre re-buscar).');

function cacheFor(ctx: ToolInvocation): DocCache {
  return new DocCache(resolveInWorkspace(ctx, RESEARCH_CACHE_REL));
}

/** Busca com timeout real (AbortController) + cache por idade. */
async function fetchCached(
  fetcher: FetchLike,
  ctx: ToolInvocation,
  url: string,
  timeoutMs: number,
  maxAgeMs: number,
): Promise<{ entry: CacheEntry; fromCache: boolean }> {
  const cache = cacheFor(ctx);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.fetchedAt <= maxAgeMs) {
    return { entry: hit, fromCache: true };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetcher(url, { signal: ac.signal, headers: { 'user-agent': 'CloverOS-research/0.1' } });
  } catch (err) {
    // Rede falhou mas há cache velho → degrada graciosamente para o cache.
    if (hit) return { entry: hit, fromCache: true };
    throw new Error(`fetch falhou para ${url}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status < 200 || res.status >= 300) {
    if (hit) return { entry: hit, fromCache: true };
    throw new Error(`HTTP ${res.status} para ${url}`);
  }
  let body = await res.text();
  if (body.length > MAX_BODY_BYTES) body = body.slice(0, MAX_BODY_BYTES);
  const entry: CacheEntry = {
    url,
    contentType: res.headers.get('content-type'),
    fetchedAt: Date.now(),
    body,
  };
  cache.put(entry);
  return { entry, fromCache: false };
}

const clip = (s: string): { text: string; truncated: boolean } =>
  s.length > MAX_TEXT_CHARS ? { text: s.slice(0, MAX_TEXT_CHARS), truncated: true } : { text: s, truncated: false };

/**
 * Constrói o departamento com um fetcher específico. Produção: `researchTools`
 * (fetch global). Testes: injete um fake e obtenha as MESMAS tools.
 */
export function makeResearchTools(fetcher: FetchLike): LocalTool[] {
  // -------------------------------------------------------------------------
  // fetch_documentation
  // -------------------------------------------------------------------------
  const fetchDocumentation = defineZodTool({
    name: 'fetch_documentation',
    description:
      'Busca uma página de documentação (HTTP GET), converte HTML→texto legível e grava no cache local. Respeita cache por maxAgeMs; timeout real via AbortController.',
    input: z.object({ url: UrlInput, timeoutMs: TimeoutInput, maxAgeMs: MaxAgeInput }).strict(),
    output: z.object({
      url: z.string(),
      title: z.string(),
      text: z.string(),
      contentType: z.string().nullable(),
      fromCache: z.boolean(),
      fetchedAt: z.number(),
      truncated: z.boolean(),
    }),
    capabilities: NET,
    intent: 'read',
    pure: false,
    run: async (args, ctx) => {
      const { entry, fromCache } = await fetchCached(
        fetcher, ctx, args.url, args.timeoutMs ?? DEFAULT_TIMEOUT_MS, args.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
      );
      const isHtml = looksLikeHtml(entry.body, entry.contentType);
      const { text, truncated } = clip(isHtml ? htmlToText(entry.body) : entry.body);
      return {
        url: entry.url,
        title: isHtml ? extractTitle(entry.body) : '',
        text,
        contentType: entry.contentType,
        fromCache,
        fetchedAt: entry.fetchedAt,
        truncated,
      };
    },
  });

  // -------------------------------------------------------------------------
  // fetch_markdown
  // -------------------------------------------------------------------------
  const fetchMarkdown = defineZodTool({
    name: 'fetch_markdown',
    description: 'Busca um documento Markdown cru (HTTP GET) + extrai os headings. Cacheado.',
    input: z.object({ url: UrlInput, timeoutMs: TimeoutInput, maxAgeMs: MaxAgeInput }).strict(),
    output: z.object({
      url: z.string(),
      markdown: z.string(),
      headings: z.array(z.object({ level: z.number(), text: z.string(), line: z.number() })),
      fromCache: z.boolean(),
      truncated: z.boolean(),
    }),
    capabilities: NET,
    intent: 'read',
    pure: false,
    run: async (args, ctx) => {
      const { entry, fromCache } = await fetchCached(
        fetcher, ctx, args.url, args.timeoutMs ?? DEFAULT_TIMEOUT_MS, args.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
      );
      const { text: markdown, truncated } = clip(entry.body);
      return { url: entry.url, markdown, headings: extractHeadings(markdown), fromCache, truncated };
    },
  });

  // -------------------------------------------------------------------------
  // fetch_github_readme
  // -------------------------------------------------------------------------
  const fetchGithubReadme = defineZodTool({
    name: 'fetch_github_readme',
    description:
      'Busca o README de um repositório GitHub via raw.githubusercontent.com (HEAD, sem token). Cacheado.',
    input: z
      .object({
        owner: z.string().min(1).regex(/^[\w.-]+$/),
        repo: z.string().min(1).regex(/^[\w.-]+$/),
        timeoutMs: TimeoutInput,
        maxAgeMs: MaxAgeInput,
      })
      .strict(),
    output: z.object({
      repository: z.string(),
      sourceUrl: z.string(),
      markdown: z.string(),
      headings: z.array(z.object({ level: z.number(), text: z.string(), line: z.number() })),
      fromCache: z.boolean(),
      truncated: z.boolean(),
    }),
    capabilities: NET,
    intent: 'read',
    pure: false,
    run: async (args, ctx) => {
      const url = `https://raw.githubusercontent.com/${args.owner}/${args.repo}/HEAD/README.md`;
      const { entry, fromCache } = await fetchCached(
        fetcher, ctx, url, args.timeoutMs ?? DEFAULT_TIMEOUT_MS, args.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
      );
      const { text: markdown, truncated } = clip(entry.body);
      return {
        repository: `${args.owner}/${args.repo}`,
        sourceUrl: url,
        markdown,
        headings: extractHeadings(markdown),
        fromCache,
        truncated,
      };
    },
  });

  // -------------------------------------------------------------------------
  // fetch_openapi
  // -------------------------------------------------------------------------
  const fetchOpenapi = defineZodTool({
    name: 'fetch_openapi',
    description:
      'Busca e parseia uma spec OpenAPI/Swagger em JSON (YAML não suportado — sem parser YAML no arsenal; declarado). Retorna título, versão e operações. Cacheado.',
    input: z.object({ url: UrlInput, timeoutMs: TimeoutInput, maxAgeMs: MaxAgeInput }).strict(),
    output: z.object({
      url: z.string(),
      title: z.string(),
      version: z.string(),
      openapiVersion: z.string(),
      pathCount: z.number(),
      operations: z.array(z.object({ method: z.string(), path: z.string(), summary: z.string() })),
      truncatedOperations: z.boolean(),
      fromCache: z.boolean(),
    }),
    capabilities: NET,
    intent: 'read',
    pure: false,
    run: async (args, ctx) => {
      const { entry, fromCache } = await fetchCached(
        fetcher, ctx, args.url, args.timeoutMs ?? DEFAULT_TIMEOUT_MS, args.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
      );
      let spec: Record<string, unknown>;
      try {
        spec = JSON.parse(entry.body) as Record<string, unknown>;
      } catch {
        throw new Error(`fetch_openapi: corpo de ${args.url} não é JSON válido (YAML não suportado)`);
      }
      const openapiVersion = String(spec.openapi ?? spec.swagger ?? '');
      if (!openapiVersion) throw new Error('fetch_openapi: JSON não tem campo openapi/swagger — não é uma spec');
      const info = (spec.info ?? {}) as Record<string, unknown>;
      const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
      const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
      const operations: Array<{ method: string; path: string; summary: string }> = [];
      for (const p of Object.keys(paths).sort()) {
        for (const m of METHODS) {
          const op = paths[p]?.[m] as Record<string, unknown> | undefined;
          if (op) operations.push({ method: m.toUpperCase(), path: p, summary: String(op.summary ?? '') });
        }
      }
      const CAP = 200;
      return {
        url: entry.url,
        title: String(info.title ?? ''),
        version: String(info.version ?? ''),
        openapiVersion,
        pathCount: Object.keys(paths).length,
        operations: operations.slice(0, CAP),
        truncatedOperations: operations.length > CAP,
        fromCache,
      };
    },
  });

  // -------------------------------------------------------------------------
  // fetch_json_schema
  // -------------------------------------------------------------------------
  const fetchJsonSchema = defineZodTool({
    name: 'fetch_json_schema',
    description: 'Busca e parseia um JSON Schema: $schema/$id/title/type + propriedades de topo. Cacheado.',
    input: z.object({ url: UrlInput, timeoutMs: TimeoutInput, maxAgeMs: MaxAgeInput }).strict(),
    output: z.object({
      url: z.string(),
      schemaDialect: z.string(),
      id: z.string(),
      title: z.string(),
      type: z.string(),
      required: z.array(z.string()),
      properties: z.array(z.object({ name: z.string(), type: z.string() })),
      fromCache: z.boolean(),
    }),
    capabilities: NET,
    intent: 'read',
    pure: false,
    run: async (args, ctx) => {
      const { entry, fromCache } = await fetchCached(
        fetcher, ctx, args.url, args.timeoutMs ?? DEFAULT_TIMEOUT_MS, args.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
      );
      let schema: Record<string, unknown>;
      try {
        schema = JSON.parse(entry.body) as Record<string, unknown>;
      } catch {
        throw new Error(`fetch_json_schema: corpo de ${args.url} não é JSON válido`);
      }
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      return {
        url: entry.url,
        schemaDialect: String(schema.$schema ?? ''),
        id: String(schema.$id ?? schema.id ?? ''),
        title: String(schema.title ?? ''),
        type: String(schema.type ?? ''),
        required: Array.isArray(schema.required) ? schema.required.map(String).sort() : [],
        properties: Object.keys(props)
          .sort()
          .map((name) => ({ name, type: String(props[name]?.type ?? '') })),
        fromCache,
      };
    },
  });

  // -------------------------------------------------------------------------
  // cache_documentation
  // -------------------------------------------------------------------------
  const cacheDocumentation = defineZodTool({
    name: 'cache_documentation',
    description:
      'Semeia o cache de pesquisa manualmente (URL → conteúdo). Torna docs disponíveis offline p/ search/summarize sem depender de rede.',
    input: z
      .object({
        url: UrlInput,
        content: z.string().min(1),
        contentType: z.string().optional(),
      })
      .strict(),
    output: z.object({ url: z.string(), key: z.string(), bytes: z.number() }),
    capabilities: READ_ONLY,
    intent: 'read',
    pure: false,
    run: (args, ctx) => {
      const cache = cacheFor(ctx);
      const key = cache.put({
        url: args.url,
        contentType: args.contentType ?? null,
        fetchedAt: Date.now(),
        body: args.content,
      });
      return { url: args.url, key, bytes: Buffer.byteLength(args.content, 'utf8') };
    },
  });

  // -------------------------------------------------------------------------
  // search_documentation
  // -------------------------------------------------------------------------
  const searchDocumentation = defineZodTool({
    name: 'search_documentation',
    description:
      'Busca por relevância (BM25) NO CACHE LOCAL de documentação (o que já foi buscado/semeado). NÃO é busca na web — não há API de search disponível; declarado.',
    input: z
      .object({ query: z.string().min(1), topK: z.number().int().min(1).max(50).optional() })
      .strict(),
    output: z.object({
      results: z.array(z.object({ url: z.string(), score: z.number(), snippet: z.string() })),
      total: z.number(),
      corpusSize: z.number(),
      engine: z.literal('bm25-local-cache'),
    }),
    capabilities: READ_ONLY,
    intent: 'read',
    pure: false,
    run: (args, ctx) => {
      const entries = cacheFor(ctx).all();
      const docs = entries.map((e) => ({
        id: e.url,
        text: looksLikeHtml(e.body, e.contentType) ? htmlToText(e.body) : e.body,
      }));
      const textById = new Map(docs.map((d) => [d.id, d.text]));
      const ranked = rankDocuments(args.query, docs, args.topK ?? 10);
      const results = ranked.map((r) => ({
        url: r.id,
        score: r.score,
        snippet: (textById.get(r.id) ?? '').slice(0, 300),
      }));
      return { results, total: results.length, corpusSize: entries.length, engine: 'bm25-local-cache' as const };
    },
  });

  // -------------------------------------------------------------------------
  // summarize_documentation
  // -------------------------------------------------------------------------
  const summarizeDocumentation = defineZodTool({
    name: 'summarize_documentation',
    description:
      'Sumarização EXTRATIVA e determinística de um doc do cache (ou busca se ausente): árvore de headings, primeiro parágrafo por seção, contagens. Não é prosa de LLM — objeto tipado.',
    input: z.object({ url: UrlInput, timeoutMs: TimeoutInput, maxAgeMs: MaxAgeInput }).strict(),
    output: z.object({
      url: z.string(),
      fromCache: z.boolean(),
      headings: z.array(z.object({ level: z.number(), text: z.string(), line: z.number() })),
      sections: z.array(z.object({ heading: z.string(), level: z.number(), firstParagraph: z.string() })),
      wordCount: z.number(),
      codeBlockCount: z.number(),
      linkCount: z.number(),
    }),
    capabilities: NET,
    intent: 'read',
    pure: false,
    run: async (args, ctx) => {
      const { entry, fromCache } = await fetchCached(
        fetcher, ctx, args.url, args.timeoutMs ?? DEFAULT_TIMEOUT_MS, args.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
      );
      const text = looksLikeHtml(entry.body, entry.contentType) ? htmlToText(entry.body) : entry.body;
      return { url: entry.url, fromCache, ...summarizeDocument(text) };
    },
  });

  return [
    fetchDocumentation,
    fetchMarkdown,
    fetchGithubReadme,
    fetchOpenapi,
    fetchJsonSchema,
    cacheDocumentation,
    searchDocumentation,
    summarizeDocumentation,
  ];
}

export { cacheKey, RESEARCH_CACHE_REL };

/** Departamento com o fetch REAL do Node (produção). */
export const researchTools: LocalTool[] = makeResearchTools(
  (url, init) => fetch(url, init) as ReturnType<FetchLike>,
);
