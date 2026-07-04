/**
 * intelligence/ — Code Intelligence Department (FASE 4.5).
 *
 * Testa o motor puro (graph: resolução de import, ciclos, deps) e as tools via
 * handler contra um workspace temporário REAL contendo: ciclo a→b→c→a, export
 * nunca importado, arquivo órfão, TODO/FIXME, process.env, função grande,
 * teste convencional e package.json com main/scripts.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ToolInvocation, ToolResult } from '@clover/contracts';

import {
  findBuildScriptsTool,
  findConfigurationsTool,
  findCyclesTool,
  findDependenciesTool,
  findEntrypointsTool,
  findEnvironmentVariablesTool,
  findFixmesTool,
  findLargeFunctionsTool,
  findReverseDependenciesTool,
  findTestFilesTool,
  findTodosTool,
  findUnusedExportsTool,
  findUnusedFilesTool,
  summarizeProjectArchitectureTool,
} from '../src/index.js';
import { buildImportGraph, findCycles, resolveRelativeImport } from '../src/intelligence/graph.js';

let dir: string;

function ctx(): ToolInvocation {
  return {
    taskId: 't', traceId: 'tr', workspacePath: dir,
    token: { id: 'k', taskId: 't', caps: [{ kind: 'fs.read', pathGlob: '**' }], issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sig: 't' },
    emit: () => {},
  };
}

async function run(tool: { handler: (a: unknown, c: ToolInvocation) => Promise<unknown> }, args: unknown = {}): Promise<ToolResult> {
  return (await tool.handler(args, ctx())) as ToolResult;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'clover-intel-'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'test'));

  // Ciclo a → b → c → a. `a` também usa TODO, env var e pacote externo.
  writeFileSync(join(dir, 'src', 'a.ts'), [
    "import { b } from './b.js';",
    "import { z } from 'zod';",
    '// TODO: melhorar isto',
    'const key = process.env.API_KEY;',
    "const port = process.env['HTTP_PORT'];",
    'export function a(): string { return b() + String(z) + key + port; }',
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'b.ts'), [
    "import { c } from './c.js';",
    '// FIXME: quebrado',
    'export function b(): string { return c(); }',
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'c.ts'), [
    "import { a } from './a.js';",
    'export function c(): string { return typeof a; }',
  ].join('\n'));

  // Órfão: ninguém importa; export nunca nomeado em import algum.
  writeFileSync(join(dir, 'src', 'orphan.ts'), 'export function neverUsed(): number { return 1; }\n');

  // Função grande (60 linhas de corpo).
  const body = Array.from({ length: 60 }, (_, i) => `  const v${i} = ${i};`).join('\n');
  writeFileSync(join(dir, 'src', 'big.ts'), `export function bigFn(): void {\n${body}\n}\n`);

  // Teste convencional.
  writeFileSync(join(dir, 'test', 'a.test.ts'), "import { a } from '../src/a.js';\nexport const t = a;\n");

  // Manifest + config.
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'fixture-pkg',
    main: 'src/a.ts',
    scripts: { build: 'tsc', test: 'vitest run' },
  }));
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
});

afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

// ===========================================================================
// Motor puro
// ===========================================================================

describe('intelligence/ graph (puro)', () => {
  const files = new Set(['src/a.ts', 'src/b.ts', 'src/dir/index.ts']);

  it('resolveRelativeImport cobre .js→.ts, extensão implícita e index', () => {
    expect(resolveRelativeImport('src/a.ts', './b.js', files)).toBe('src/b.ts');
    expect(resolveRelativeImport('src/a.ts', './b', files)).toBe('src/b.ts');
    expect(resolveRelativeImport('src/a.ts', './dir', files)).toBe('src/dir/index.ts');
    expect(resolveRelativeImport('src/b.ts', '../src/a.js', files)).toBe('src/a.ts');
    expect(resolveRelativeImport('src/a.ts', 'zod', files)).toBeNull(); // externo
    expect(resolveRelativeImport('src/a.ts', './missing.js', files)).toBeNull();
  });

  it('findCycles canonicaliza e deduplica (a→b→c→a = 1 ciclo)', () => {
    const graph = buildImportGraph(
      ['a.ts', 'b.ts', 'c.ts'],
      [
        { path: 'a.ts', module: './b.js', names: 'b', line: 1 },
        { path: 'b.ts', module: './c.js', names: 'c', line: 1 },
        { path: 'c.ts', module: './a.js', names: 'a', line: 1 },
      ],
    );
    const cycles = findCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]![0]).toBe('a.ts'); // rotacionado p/ menor nó
    expect(cycles[0]).toHaveLength(3);
  });

  it('grafo separa arestas internas de externas', () => {
    const graph = buildImportGraph(
      ['a.ts', 'b.ts'],
      [
        { path: 'a.ts', module: './b.js', names: 'b', line: 1 },
        { path: 'a.ts', module: 'node:fs', names: 'readFileSync', line: 2 },
      ],
    );
    expect(graph.edges).toHaveLength(1);
    expect(graph.externals).toHaveLength(1);
    expect(graph.externals[0]?.module).toBe('node:fs');
  });
});

// ===========================================================================
// Tools (handler → ToolResult) contra workspace real
// ===========================================================================

describe('intelligence/ tools', () => {
  it('find_cycles detecta o ciclo a→b→c→a', async () => {
    const res = await run(findCyclesTool);
    expect(res.success).toBe(true);
    const out = res.output as { cycles: string[][]; total: number };
    expect(out.total).toBe(1);
    expect(out.cycles[0]).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('find_todos e find_fixmes acham os marcadores', async () => {
    const todos = (await run(findTodosTool)).output as { hits: Array<{ file: string }> };
    expect(todos.hits.some((h) => h.file.endsWith('src/a.ts'))).toBe(true);
    const fixmes = (await run(findFixmesTool)).output as { hits: Array<{ file: string }> };
    expect(fixmes.hits.some((h) => h.file.endsWith('src/b.ts'))).toBe(true);
  });

  it('find_dependencies separa interno (resolvido) e externo', async () => {
    const res = await run(findDependenciesTool, { path: 'src/a.ts' });
    const out = res.output as { internal: string[]; external: string[] };
    expect(out.internal).toEqual(['src/b.ts']);
    expect(out.external).toEqual(['zod']);
  });

  it('find_reverse_dependencies acha quem importa', async () => {
    const res = await run(findReverseDependenciesTool, { path: 'src/a.ts' });
    const out = res.output as { dependents: string[] };
    // c.ts importa a.ts (ciclo); test/a.test.ts também.
    expect(out.dependents).toContain('src/c.ts');
    expect(out.dependents).toContain('test/a.test.ts');
  });

  it('find_unused_exports flagra neverUsed; não flagra os usados', async () => {
    const res = await run(findUnusedExportsTool);
    const out = res.output as { unused: Array<{ name: string }>; note: string };
    const names = out.unused.map((u) => u.name);
    expect(names).toContain('neverUsed');
    expect(names).not.toContain('a'); // importado por c.ts e pelo teste
    expect(names).not.toContain('b');
    expect(out.note.length).toBeGreaterThan(0);
  });

  it('find_unused_files flagra orphan.ts; não flagra importados nem testes', async () => {
    const res = await run(findUnusedFilesTool);
    const out = res.output as { unused: string[] };
    expect(out.unused).toContain('src/orphan.ts');
    expect(out.unused).not.toContain('src/b.ts'); // importado por a.ts
    expect(out.unused.some((f) => f.includes('.test.'))).toBe(false);
  });

  it('find_large_functions respeita o limiar', async () => {
    const at50 = (await run(findLargeFunctionsTool, { minLines: 50 })).output as { found: Array<{ name: string; lines: number }> };
    expect(at50.found.some((f) => f.name === 'bigFn')).toBe(true);
    const at100 = (await run(findLargeFunctionsTool, { minLines: 100 })).output as { found: unknown[] };
    expect(at100.found).toHaveLength(0);
  });

  it('find_test_files, find_configurations e find_build_scripts por convenção', async () => {
    const tests = (await run(findTestFilesTool)).output as { files: string[] };
    expect(tests.files).toEqual(['test/a.test.ts']);

    const configs = (await run(findConfigurationsTool)).output as { files: string[] };
    expect(configs.files).toContain('tsconfig.json');

    const scripts = (await run(findBuildScriptsTool)).output as { packages: Array<{ package: string | null; scripts: Record<string, string> }> };
    expect(scripts.packages[0]?.package).toBe('fixture-pkg');
    expect(scripts.packages[0]?.scripts.build).toBe('tsc');
  });

  it('find_entrypoints combina manifest (main) e convenção', async () => {
    const res = await run(findEntrypointsTool);
    const out = res.output as { fromManifests: Array<{ entry: string; source: string }>; conventional: string[] };
    expect(out.fromManifests.some((e) => e.entry === 'src/a.ts' && e.source === 'main')).toBe(true);
  });

  it('find_environment_variables acha as duas formas de acesso', async () => {
    const res = await run(findEnvironmentVariablesTool);
    const out = res.output as { uniqueNames: string[]; variables: Array<{ name: string; file: string }> };
    expect(out.uniqueNames).toEqual(['API_KEY', 'HTTP_PORT']);
    expect(out.variables.every((v) => v.file === 'src/a.ts')).toBe(true);
  });

  it('summarize_project_architecture agrega stats/pacotes/ciclos', async () => {
    const res = await run(summarizeProjectArchitectureTool);
    expect(res.success).toBe(true);
    const out = res.output as { files: number; packages: Array<{ name: string | null }>; cycleCount: number; topExternalModules: Array<{ module: string }>; testFileCount: number };
    expect(out.files).toBeGreaterThanOrEqual(6);
    expect(out.packages.map((p) => p.name)).toContain('fixture-pkg');
    expect(out.cycleCount).toBe(1);
    expect(out.topExternalModules.some((m) => m.module === 'zod')).toBe(true);
    expect(out.testFileCount).toBe(1);
  });
});
