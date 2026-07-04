/**
 * Namespace `index/` — Workspace Index (FASE 2.5). Índice persistente e
 * incremental do workspace (SQLite via sql.js), consultado pelas tools de
 * inteligência de código em vez de reprocessar a AST a cada chamada.
 *
 * **Exceção consciente ao invariante de write-gate (TOOLS.md #6):** estas tools
 * têm `intent: 'read'` mas gravam o índice em `.clover/index.db` (cache
 * gitignored, `*.db`). É uma leitura-com-cache — não alteram o *código-fonte* do
 * usuário — por isso não passam pelo Governor. A trava de escrita de fonte
 * continua valendo para `fs/` (write_file/patch_file).
 *
 * Escopo honesto: `find_references` é **baseado em nome (sintático)** — casa
 * definições e sites de import pelo identificador, não por resolução semântica
 * de binding (que exigiria TypeChecker). `rename_symbol` é **dry-run/preview**:
 * lista o que mudaria e NÃO aplica nada (um rename seguro precisa do mesmo
 * TypeChecker — aplicar por nome corromperia símbolos homônimos não relacionados).
 */

import type { CapabilityRequest } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';
import { z } from 'zod';

import { defineZodTool } from '../abi.js';
import { ensureIndex, INDEX_DB_REL } from './indexer.js';

const FS_READ: CapabilityRequest[] = [{ kind: 'fs.read' }];

const DefinitionSchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.string(),
  line: z.number(),
  exported: z.boolean(),
  container: z.string().nullable(),
});

const ImportSiteSchema = z.object({
  path: z.string(),
  module: z.string(),
  names: z.string(),
  line: z.number(),
});

// ===========================================================================
// workspace_index
// ===========================================================================

export const workspaceIndexTool: LocalTool = defineZodTool({
  name: 'workspace_index',
  description:
    'Constrói/atualiza o índice persistente do workspace (símbolos + grafo de imports) em `.clover/index.db`. Incremental: só reparseia arquivos com mtime/size alterados. Base para find_references e outras consultas.',
  input: z.object({}).strict(),
  output: z.object({
    dbPath: z.string().describe('Caminho relativo do índice persistido.'),
    indexed: z.number().describe('Arquivos (re)indexados nesta passada.'),
    skipped: z.number().describe('Arquivos inalterados (pulados pelo incremental).'),
    removed: z.number().describe('Arquivos removidos do índice (sumiram do disco).'),
    files: z.number(),
    symbols: z.number(),
    imports: z.number(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: async (_args, ctx) => {
    const { store, refresh } = await ensureIndex(ctx);
    try {
      const stats = store.stats();
      return { dbPath: INDEX_DB_REL, ...refresh, ...stats };
    } finally {
      store.close();
    }
  },
});

// ===========================================================================
// find_references
// ===========================================================================

export const findReferencesTool: LocalTool = defineZodTool({
  name: 'find_references',
  description:
    'Localiza referências a um símbolo no workspace consultando o índice: definições (declarações) + sites de import que o nomeiam. Baseado em NOME (sintático), não em resolução semântica de binding.',
  input: z
    .object({
      name: z.string().min(1).describe('Nome exato do símbolo.'),
    })
    .strict(),
  output: z.object({
    name: z.string(),
    found: z.boolean(),
    definitions: z.array(DefinitionSchema),
    importSites: z.array(ImportSiteSchema),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: async (args, ctx) => {
    const { store } = await ensureIndex(ctx);
    try {
      const definitions = store.symbolsByName(args.name);
      const importSites = store.importSitesReferencing(args.name);
      return {
        name: args.name,
        found: definitions.length > 0 || importSites.length > 0,
        definitions,
        importSites,
      };
    } finally {
      store.close();
    }
  },
});

// ===========================================================================
// rename_symbol (dry-run / preview)
// ===========================================================================

export const renameSymbolTool: LocalTool = defineZodTool({
  name: 'rename_symbol',
  description:
    'PREVIEW (dry-run) de renomeação: lista, via índice, os sites que mudariam ao renomear um símbolo. NÃO aplica nada — um rename seguro exige resolução semântica (TypeChecker); aplicar por nome corromperia homônimos. Use o preview para decidir.',
  input: z
    .object({
      name: z.string().min(1).describe('Nome atual do símbolo.'),
      newName: z.string().min(1).describe('Novo nome proposto (apenas para o preview).'),
    })
    .strict(),
  output: z.object({
    name: z.string(),
    newName: z.string(),
    applied: z.literal(false),
    wouldChange: z.array(
      z.object({
        path: z.string(),
        line: z.number(),
        site: z.enum(['declaration', 'import']),
        kind: z.string(),
      }),
    ),
    note: z.string(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: async (args, ctx) => {
    const { store } = await ensureIndex(ctx);
    try {
      const defs = store.symbolsByName(args.name).map((d) => ({
        path: d.path,
        line: d.line,
        site: 'declaration' as const,
        kind: d.kind,
      }));
      const imports = store.importSitesReferencing(args.name).map((i) => ({
        path: i.path,
        line: i.line,
        site: 'import' as const,
        kind: 'import',
      }));
      return {
        name: args.name,
        newName: args.newName,
        applied: false as const,
        wouldChange: [...defs, ...imports],
        note: 'Preview apenas. Aplicação segura de rename requer resolução semântica (TypeChecker) — fatia futura.',
      };
    } finally {
      store.close();
    }
  },
});

/** Todas as tools do namespace index/. */
export const indexTools: LocalTool[] = [workspaceIndexTool, findReferencesTool, renameSymbolTool];
