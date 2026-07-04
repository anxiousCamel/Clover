/**
 * Namespace `intelligence/` — Code Intelligence Department (FASE 4.5).
 *
 * Compreensão profunda do workspace construída SOBRE o Workspace Index (FASE
 * 2.5): as tools consultam o índice SQLite (símbolos + grafo de imports) em vez
 * de reprocessar a AST a cada chamada. Ver `intelligence/graph.ts` (teoria de
 * grafos pura) e `intelligence/scan.ts` (scanners de convenção/conteúdo).
 *
 * Mesma exceção de write-gate do `index/`: tools `read` que atualizam apenas o
 * cache `.clover/index.db` — nunca código do usuário.
 *
 * Escopo honesto por tool está na descrição de cada uma (o Planner as vê):
 * análise **sintática/name-based** — sem TypeChecker, sem call-graph semântico.
 */

import type { CapabilityRequest, ToolInvocation } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';
import { z } from 'zod';

import { defineZodTool } from '../abi.js';
import { resolveInWorkspace } from '../sys/fs.js';
import { ensureIndex } from '../index/indexer.js';
import type { WorkspaceIndexStore } from '../index/store.js';
import {
  buildImportGraph,
  dependenciesOf,
  findCycles,
  reverseDependenciesOf,
  type ImportGraph,
} from './graph.js';
import {
  CONFIG_FILE_RE,
  ENTRYPOINT_NAME_RE,
  TEST_FILE_RE,
  scanConfigFiles,
  scanEnvVars,
  scanMarkers,
  scanPackageManifests,
} from './scan.js';

const FS_READ: CapabilityRequest[] = [{ kind: 'fs.read' }];

/** Abre índice + grafo, executa `fn` e SEMPRE fecha o store. */
async function withGraph<T>(
  ctx: ToolInvocation,
  fn: (store: WorkspaceIndexStore, graph: ImportGraph, files: string[]) => T,
): Promise<T> {
  const { store } = await ensureIndex(ctx);
  try {
    const files = store.allFilePaths();
    const graph = buildImportGraph(files, store.allImports());
    return fn(store, graph, files);
  } finally {
    store.close();
  }
}

const MarkerHitSchema = z.object({ file: z.string(), line: z.number(), text: z.string() });

// ===========================================================================
// find_todos / find_fixmes
// ===========================================================================

function markerTool(name: string, marker: string): LocalTool {
  return defineZodTool({
    name,
    description: `Localiza marcadores ${marker} no workspace (arquivo, linha, texto). Ignora .git/node_modules e saídas de build.`,
    input: z
      .object({ maxResults: z.number().int().min(1).max(2000).optional() })
      .strict(),
    output: z.object({
      marker: z.literal(marker),
      hits: z.array(MarkerHitSchema),
      total: z.number(),
      truncated: z.boolean(),
    }),
    capabilities: FS_READ,
    intent: 'read',
    pure: false,
    run: (args, ctx) => {
      const root = resolveInWorkspace(ctx, '.');
      const { hits, truncated } = scanMarkers(root, marker, args.maxResults ?? 500);
      return { marker: marker as never, hits, total: hits.length, truncated };
    },
  });
}

export const findTodosTool: LocalTool = markerTool('find_todos', 'TODO');
export const findFixmesTool: LocalTool = markerTool('find_fixmes', 'FIXME');

// ===========================================================================
// find_cycles
// ===========================================================================

export const findCyclesTool: LocalTool = defineZodTool({
  name: 'find_cycles',
  description:
    'Detecta ciclos de import entre arquivos do workspace via grafo do índice (imports RELATIVOS resolvidos; ciclos entre pacotes do monorepo via specifier de pacote não são detectados).',
  input: z.object({ maxCycles: z.number().int().min(1).max(200).optional() }).strict(),
  output: z.object({
    cycles: z.array(z.array(z.string())),
    total: z.number(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) =>
    withGraph(ctx, (_s, graph) => {
      const cycles = findCycles(graph, args.maxCycles ?? 50);
      return { cycles, total: cycles.length };
    }),
});

// ===========================================================================
// find_dependencies / find_reverse_dependencies
// ===========================================================================

export const findDependenciesTool: LocalTool = defineZodTool({
  name: 'find_dependencies',
  description:
    'Dependências diretas de um arquivo: internas (imports relativos resolvidos para arquivos do workspace) + externas (pacotes/builtins). Via índice.',
  input: z.object({ path: z.string().min(1).describe('Path relativo indexado (ex.: src/a.ts).') }).strict(),
  output: z.object({
    path: z.string(),
    internal: z.array(z.string()),
    external: z.array(z.string()),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) =>
    withGraph(ctx, (_s, graph) => ({ path: args.path, ...dependenciesOf(graph, args.path) })),
});

export const findReverseDependenciesTool: LocalTool = defineZodTool({
  name: 'find_reverse_dependencies',
  description:
    'Quem importa um arquivo (dependentes reversos, via imports relativos resolvidos no índice). Base para análise de impacto de uma mudança.',
  input: z.object({ path: z.string().min(1) }).strict(),
  output: z.object({
    path: z.string(),
    dependents: z.array(z.string()),
    total: z.number(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) =>
    withGraph(ctx, (_s, graph) => {
      const dependents = reverseDependenciesOf(graph, args.path);
      return { path: args.path, dependents, total: dependents.length };
    }),
});

// ===========================================================================
// find_unused_exports / find_unused_files
// ===========================================================================

const UNUSED_EXPORT_NOTE =
  'Name-based: um export é "usado" se algum import do workspace nomeia o identificador. ' +
  'Re-exports (`export {} from`, `export *`) e dynamic import() NÃO contam como uso — ' +
  'exports consumidos só via barrel podem aparecer como falso positivo.';

export const findUnusedExportsTool: LocalTool = defineZodTool({
  name: 'find_unused_exports',
  description:
    'Símbolos exportados que nenhum import do workspace nomeia (candidatos a código morto). Name-based via índice — ver campo note para limites (barrels/export * geram falsos positivos).',
  input: z.object({}).strict(),
  output: z.object({
    unused: z.array(
      z.object({ path: z.string(), name: z.string(), kind: z.string(), line: z.number() }),
    ),
    total: z.number(),
    note: z.string(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (_args, ctx) =>
    withGraph(ctx, (store) => {
      const importedNames = new Set<string>();
      for (const imp of store.allImports()) {
        for (const raw of imp.names.split(',')) {
          const n = raw.trim().replace(/^\* as /, '');
          if (n) importedNames.add(n);
        }
      }
      const unused = store
        .exportedSymbols()
        .filter((s) => !importedNames.has(s.name) && !TEST_FILE_RE.test(s.path))
        .map((s) => ({ path: s.path, name: s.name, kind: s.kind, line: s.line }));
      return { unused, total: unused.length, note: UNUSED_EXPORT_NOTE };
    }),
});

const UNUSED_FILE_NOTE =
  'Um arquivo é "usado" se algum import RELATIVO resolvido aponta para ele. Entrypoints ' +
  'convencionais (index/main/cli/...), testes, configs e .d.ts são excluídos. Arquivos ' +
  'consumidos só via specifier de pacote (barrel de outro pacote) podem ser falso positivo.';

export const findUnusedFilesTool: LocalTool = defineZodTool({
  name: 'find_unused_files',
  description:
    'Arquivos indexados sem nenhum import interno apontando para eles (candidatos a órfãos). Exclui entrypoints/testes/configs por convenção — ver note para limites.',
  input: z.object({}).strict(),
  output: z.object({
    unused: z.array(z.string()),
    total: z.number(),
    note: z.string(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (_args, ctx) =>
    withGraph(ctx, (_s, graph, files) => {
      const imported = new Set(graph.edges.map((e) => e.to));
      const unused = files
        .filter(
          (f) =>
            !imported.has(f) &&
            !TEST_FILE_RE.test(f) &&
            !CONFIG_FILE_RE.test(f) &&
            !ENTRYPOINT_NAME_RE.test(f) &&
            !f.endsWith('.d.ts'),
        )
        .sort();
      return { unused, total: unused.length, note: UNUSED_FILE_NOTE };
    }),
});

// ===========================================================================
// find_large_functions / find_large_classes
// ===========================================================================

const LargeSymbolSchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.string(),
  line: z.number(),
  endLine: z.number(),
  lines: z.number(),
  container: z.string().nullable(),
});

function largeSymbolTool(name: string, kinds: string[], defaultMin: number, label: string): LocalTool {
  return defineZodTool({
    name,
    description: `Localiza ${label} acima de um limiar de linhas (span da declaração, via índice). Candidatos a refatoração (SRP).`,
    input: z.object({ minLines: z.number().int().min(1).optional().describe(`Default ${defaultMin}.`) }).strict(),
    output: z.object({
      minLines: z.number(),
      found: z.array(LargeSymbolSchema),
      total: z.number(),
    }),
    capabilities: FS_READ,
    intent: 'read',
    pure: false,
    run: (args, ctx) =>
      withGraph(ctx, (store) => {
        const minLines = args.minLines ?? defaultMin;
        const found = store
          .symbolsByKinds(kinds)
          .filter((s) => s.endLine != null && s.endLine - s.line + 1 >= minLines)
          .map((s) => ({
            path: s.path,
            name: s.name,
            kind: s.kind,
            line: s.line,
            endLine: s.endLine as number,
            lines: (s.endLine as number) - s.line + 1,
            container: s.container,
          }))
          .sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
        return { minLines, found, total: found.length };
      }),
  });
}

export const findLargeFunctionsTool: LocalTool = largeSymbolTool(
  'find_large_functions',
  ['function', 'method'],
  50,
  'funções/métodos grandes',
);
export const findLargeClassesTool: LocalTool = largeSymbolTool(
  'find_large_classes',
  ['class'],
  200,
  'classes grandes',
);

// ===========================================================================
// find_test_files / find_entrypoints / find_configurations / find_build_scripts
// ===========================================================================

export const findTestFilesTool: LocalTool = defineZodTool({
  name: 'find_test_files',
  description: 'Arquivos de teste do workspace por convenção (*.test.*, *.spec.*, __tests__/), via índice.',
  input: z.object({}).strict(),
  output: z.object({ files: z.array(z.string()), total: z.number() }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (_args, ctx) =>
    withGraph(ctx, (_s, _g, files) => {
      const tests = files.filter((f) => TEST_FILE_RE.test(f)).sort();
      return { files: tests, total: tests.length };
    }),
});

export const findEntrypointsTool: LocalTool = defineZodTool({
  name: 'find_entrypoints',
  description:
    'Entrypoints do workspace: campos main/bin dos package.json + arquivos com nome convencional (index/main/cli/app/server).',
  input: z.object({}).strict(),
  output: z.object({
    fromManifests: z.array(z.object({ package: z.string().nullable(), manifest: z.string(), entry: z.string(), source: z.enum(['main', 'bin']) })),
    conventional: z.array(z.string()),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (_args, ctx) =>
    withGraph(ctx, (_s, _g, files) => {
      const root = resolveInWorkspace(ctx, '.');
      const fromManifests: Array<{ package: string | null; manifest: string; entry: string; source: 'main' | 'bin' }> = [];
      for (const m of scanPackageManifests(root)) {
        if (m.main) fromManifests.push({ package: m.name, manifest: m.path, entry: m.main, source: 'main' });
        for (const b of m.bin) fromManifests.push({ package: m.name, manifest: m.path, entry: b, source: 'bin' });
      }
      const conventional = files.filter((f) => ENTRYPOINT_NAME_RE.test(f)).sort();
      return { fromManifests, conventional };
    }),
});

export const findConfigurationsTool: LocalTool = defineZodTool({
  name: 'find_configurations',
  description:
    'Arquivos de configuração por convenção (tsconfig*.json, *.config.{js,ts,...}, dotfiles rc) sob o workspace, via walk (configs JSON não entram no índice de AST).',
  input: z.object({}).strict(),
  output: z.object({ files: z.array(z.string()), total: z.number() }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (_args, ctx) => {
    const files = scanConfigFiles(resolveInWorkspace(ctx, '.'));
    return { files, total: files.length };
  },
});

export const findBuildScriptsTool: LocalTool = defineZodTool({
  name: 'find_build_scripts',
  description: 'Scripts de build/teste declarados nos package.json do workspace (nome → comando, por pacote).',
  input: z.object({}).strict(),
  output: z.object({
    packages: z.array(
      z.object({
        package: z.string().nullable(),
        manifest: z.string(),
        scripts: z.record(z.string()),
      }),
    ),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (_args, ctx) => {
    const root = resolveInWorkspace(ctx, '.');
    const packages = scanPackageManifests(root)
      .filter((m) => Object.keys(m.scripts).length > 0)
      .map((m) => ({ package: m.name, manifest: m.path, scripts: m.scripts }));
    return { packages };
  },
});

// ===========================================================================
// find_environment_variables
// ===========================================================================

export const findEnvironmentVariablesTool: LocalTool = defineZodTool({
  name: 'find_environment_variables',
  description:
    'Variáveis de ambiente usadas no código (`process.env.X` / `process.env["X"]`), com arquivo e linha. Lê os arquivos listados pelo índice.',
  input: z.object({}).strict(),
  output: z.object({
    variables: z.array(z.object({ name: z.string(), file: z.string(), line: z.number() })),
    uniqueNames: z.array(z.string()),
    total: z.number(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (_args, ctx) =>
    withGraph(ctx, (_s, _g, files) => {
      const root = resolveInWorkspace(ctx, '.');
      const variables = scanEnvVars(root, files);
      const uniqueNames = [...new Set(variables.map((v) => v.name))].sort();
      return { variables, uniqueNames, total: variables.length };
    }),
});

// ===========================================================================
// summarize_project_architecture
// ===========================================================================

export const summarizeProjectArchitectureTool: LocalTool = defineZodTool({
  name: 'summarize_project_architecture',
  description:
    'Visão estruturada do workspace: stats do índice, pacotes (package.json), módulos externos mais importados, ciclos e contagem de testes. Objeto tipado, determinístico — não é prosa de LLM.',
  input: z.object({}).strict(),
  output: z.object({
    files: z.number(),
    symbols: z.number(),
    imports: z.number(),
    packages: z.array(z.object({ name: z.string().nullable(), manifest: z.string() })),
    topExternalModules: z.array(z.object({ module: z.string(), importCount: z.number() })),
    internalEdges: z.number(),
    cycleCount: z.number(),
    testFileCount: z.number(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (_args, ctx) =>
    withGraph(ctx, (store, graph, files) => {
      const root = resolveInWorkspace(ctx, '.');
      const stats = store.stats();
      const extCount = new Map<string, number>();
      for (const e of graph.externals) extCount.set(e.module, (extCount.get(e.module) ?? 0) + 1);
      const topExternalModules = [...extCount.entries()]
        .map(([module, importCount]) => ({ module, importCount }))
        .sort((a, b) => b.importCount - a.importCount || a.module.localeCompare(b.module))
        .slice(0, 15);
      return {
        ...stats,
        packages: scanPackageManifests(root).map((m) => ({ name: m.name, manifest: m.path })),
        topExternalModules,
        internalEdges: graph.edges.length,
        cycleCount: findCycles(graph).length,
        testFileCount: files.filter((f) => TEST_FILE_RE.test(f)).length,
      };
    }),
});

/** Todas as tools do namespace intelligence/. */
export const intelligenceTools: LocalTool[] = [
  findTodosTool,
  findFixmesTool,
  findCyclesTool,
  findDependenciesTool,
  findReverseDependenciesTool,
  findUnusedExportsTool,
  findUnusedFilesTool,
  findLargeFunctionsTool,
  findLargeClassesTool,
  findTestFilesTool,
  findEntrypointsTool,
  findConfigurationsTool,
  findBuildScriptsTool,
  findEnvironmentVariablesTool,
  summarizeProjectArchitectureTool,
];
