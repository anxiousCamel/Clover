/**
 * Namespace `knowledge/` — Knowledge Base Department (FASE 1, "O Cérebro").
 *
 * Banco de conhecimento HÍBRIDO: Markdown legível em `.clover/knowledge/*.md`
 * (fonte da verdade) + índice SQLite em `.clover/knowledge.db` (consulta
 * estruturada). Ver store.ts (híbrido/reconciliação), rank.ts (BM25),
 * markdown.ts (formato).
 *
 * Intents honestos: criação/edição/tag/link = `write` (conteúdo durável do
 * usuário-agente, passa pelo Governor); remoção = `destructive`; consultas =
 * `read`. O índice .db é cache reconstruível; os .md NÃO são cache — por isso
 * escrita aqui é gated, diferente do `index/`.
 */

import type { CapabilityRequest, ToolInvocation } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';
import { z } from 'zod';

import { defineZodTool } from '../abi.js';
import { resolveInWorkspace } from '../sys/fs.js';
import { rankDocuments } from './rank.js';
import { KNOWLEDGE_DB_REL, KNOWLEDGE_DIR_REL, KnowledgeStore } from './store.js';

const FS_READ: CapabilityRequest[] = [{ kind: 'fs.read' }];
const FS_WRITE: CapabilityRequest[] = [{ kind: 'fs.write' }];

/** Abre a base do workspace, executa, persiste (se `mutating`) e SEMPRE fecha. */
async function withKnowledge<T>(
  ctx: ToolInvocation,
  mutating: boolean,
  fn: (store: KnowledgeStore) => T,
): Promise<T> {
  const store = await KnowledgeStore.open(
    resolveInWorkspace(ctx, KNOWLEDGE_DB_REL),
    resolveInWorkspace(ctx, KNOWLEDGE_DIR_REL),
  );
  try {
    const out = fn(store);
    if (mutating) store.persist();
    return out;
  } finally {
    store.close();
  }
}

const SummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  links: z.array(z.string()),
  updatedAt: z.number(),
});

const DocumentSchema = SummarySchema.extend({
  content: z.string(),
  createdAt: z.number(),
});

// ===========================================================================
// save_memory / update_memory / delete_memory
// ===========================================================================

export const saveMemoryTool: LocalTool = defineZodTool({
  name: 'save_memory',
  description:
    'Salva uma memória nova na base de conhecimento: Markdown legível em .clover/knowledge/<id>.md + índice SQLite. Id = slug do título (colisão → sufixo).',
  input: z
    .object({
      title: z.string().min(1).max(200),
      content: z.string().min(1),
      tags: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  output: DocumentSchema,
  capabilities: FS_WRITE,
  intent: 'write',
  pure: false,
  run: (args, ctx) =>
    withKnowledge(ctx, true, (s) => s.save(args.title, args.content, args.tags ?? [], Date.now())),
});

export const updateMemoryTool: LocalTool = defineZodTool({
  name: 'update_memory',
  description: 'Atualiza título/conteúdo/tags de uma memória existente (md + índice). Erro se o id não existir.',
  input: z
    .object({
      id: z.string().min(1),
      title: z.string().min(1).max(200).optional(),
      content: z.string().min(1).optional(),
      tags: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  output: DocumentSchema,
  capabilities: FS_WRITE,
  intent: 'write',
  pure: false,
  run: (args, ctx) =>
    withKnowledge(ctx, true, (s) => {
      const doc = s.update(args.id, args, Date.now());
      if (!doc) throw new Error(`update_memory: memória '${args.id}' não existe`);
      return doc;
    }),
});

export const deleteMemoryTool: LocalTool = defineZodTool({
  name: 'delete_memory',
  description: 'Remove uma memória (arquivo .md + índice + links que apontavam para ela). Irreversível.',
  input: z.object({ id: z.string().min(1) }).strict(),
  output: z.object({ id: z.string(), deleted: z.boolean() }),
  capabilities: FS_WRITE,
  intent: 'destructive',
  pure: false,
  run: (args, ctx) =>
    withKnowledge(ctx, true, (s) => {
      const deleted = s.delete(args.id);
      if (!deleted) throw new Error(`delete_memory: memória '${args.id}' não existe`);
      return { id: args.id, deleted };
    }),
});

// ===========================================================================
// query_memory / semantic_search / list_memories
// ===========================================================================

export const queryMemoryTool: LocalTool = defineZodTool({
  name: 'query_memory',
  description:
    'Busca ESTRUTURADA na base: substring em título/conteúdo (LIKE) e/ou filtro por tag. Para relevância ranqueada use semantic_search.',
  input: z
    .object({
      text: z.string().min(1).optional(),
      tag: z.string().min(1).optional(),
    })
    .strict(),
  output: z.object({ results: z.array(SummarySchema), total: z.number() }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) =>
    withKnowledge(ctx, false, (s) => {
      const results = s.query(args.text, args.tag);
      return { results, total: results.length };
    }),
});

export const semanticSearchTool: LocalTool = defineZodTool({
  name: 'semantic_search',
  description:
    'Busca por RELEVÂNCIA na base de conhecimento via BM25 (ranqueamento léxico clássico — não é embedding neural; troca por embeddings entra atrás da mesma interface quando houver modelo local). Retorna memórias ordenadas por score.',
  input: z
    .object({
      query: z.string().min(1),
      topK: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  output: z.object({
    results: z.array(SummarySchema.extend({ score: z.number() })),
    total: z.number(),
    engine: z.literal('bm25'),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) =>
    withKnowledge(ctx, false, (s) => {
      const ranked = rankDocuments(args.query, s.corpus(), args.topK ?? 10);
      const results = ranked.map((r) => {
        const d = s.get(r.id)!;
        return { id: d.id, title: d.title, tags: d.tags, links: d.links, updatedAt: d.updatedAt, score: r.score };
      });
      return { results, total: results.length, engine: 'bm25' as const };
    }),
});

export const listMemoriesTool: LocalTool = defineZodTool({
  name: 'list_memories',
  description: 'Lista memórias da base (resumo: id, título, tags, links), com filtro opcional por tag.',
  input: z.object({ tag: z.string().min(1).optional() }).strict(),
  output: z.object({ memories: z.array(SummarySchema), total: z.number() }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) =>
    withKnowledge(ctx, false, (s) => {
      const memories = s.list(args.tag);
      return { memories, total: memories.length };
    }),
});

// ===========================================================================
// memory_stats / compact_memory
// ===========================================================================

export const memoryStatsTool: LocalTool = defineZodTool({
  name: 'memory_stats',
  description: 'Estatísticas da base: total de memórias, histograma de tags, links e bytes de conteúdo.',
  input: z.object({}).strict(),
  output: z.object({
    memories: z.number(),
    tags: z.array(z.object({ tag: z.string(), count: z.number() })),
    links: z.number(),
    totalContentBytes: z.number(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (_args, ctx) => withKnowledge(ctx, false, (s) => s.stats()),
});

export const compactMemoryTool: LocalTool = defineZodTool({
  name: 'compact_memory',
  description:
    'Reconcilia a base: .md novos/editados à mão entram no índice, entradas órfãs (arquivo apagado) saem, links pendurados são podados dos .md e do índice.',
  input: z.object({}).strict(),
  output: z.object({
    indexed: z.number(),
    removed: z.number(),
    danglingLinksPruned: z.number(),
  }),
  capabilities: FS_WRITE,
  intent: 'write',
  pure: false,
  run: (_args, ctx) => withKnowledge(ctx, true, (s) => s.reconcile()),
});

// ===========================================================================
// tag_memory / link_memories
// ===========================================================================

export const tagMemoryTool: LocalTool = defineZodTool({
  name: 'tag_memory',
  description: 'Adiciona e/ou remove tags de uma memória (md + índice).',
  input: z
    .object({
      id: z.string().min(1),
      add: z.array(z.string().min(1)).optional(),
      remove: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  output: z.object({ id: z.string(), tags: z.array(z.string()) }),
  capabilities: FS_WRITE,
  intent: 'write',
  pure: false,
  run: (args, ctx) =>
    withKnowledge(ctx, true, (s) => {
      const cur = s.get(args.id);
      if (!cur) throw new Error(`tag_memory: memória '${args.id}' não existe`);
      const removeSet = new Set(args.remove ?? []);
      const tags = [...new Set([...cur.tags.filter((t) => !removeSet.has(t)), ...(args.add ?? [])])].sort();
      s.update(args.id, { tags }, Date.now());
      return { id: args.id, tags };
    }),
});

export const linkMemoriesTool: LocalTool = defineZodTool({
  name: 'link_memories',
  description:
    'Cria link entre duas memórias existentes (grafo de conhecimento). bidirectional=true também cria o link reverso.',
  input: z
    .object({
      from: z.string().min(1),
      to: z.string().min(1),
      bidirectional: z.boolean().optional(),
    })
    .strict(),
  output: z.object({
    from: z.string(),
    to: z.string(),
    fromLinks: z.array(z.string()),
    toLinks: z.array(z.string()),
  }),
  capabilities: FS_WRITE,
  intent: 'write',
  pure: false,
  run: (args, ctx) =>
    withKnowledge(ctx, true, (s) => {
      const from = s.get(args.from);
      const to = s.get(args.to);
      if (!from) throw new Error(`link_memories: memória '${args.from}' não existe`);
      if (!to) throw new Error(`link_memories: memória '${args.to}' não existe`);
      const now = Date.now();
      const fromDoc = s.update(args.from, { links: [...new Set([...from.links, args.to])].sort() }, now)!;
      const toDoc = args.bidirectional
        ? s.update(args.to, { links: [...new Set([...to.links, args.from])].sort() }, now)!
        : to;
      return { from: args.from, to: args.to, fromLinks: fromDoc.links, toLinks: toDoc.links };
    }),
});

/** Todas as tools do namespace knowledge/. */
export const knowledgeTools: LocalTool[] = [
  saveMemoryTool,
  updateMemoryTool,
  deleteMemoryTool,
  queryMemoryTool,
  semanticSearchTool,
  listMemoriesTool,
  memoryStatsTool,
  compactMemoryTool,
  tagMemoryTool,
  linkMemoriesTool,
];
