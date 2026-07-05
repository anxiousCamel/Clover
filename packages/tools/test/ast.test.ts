/**
 * ast/ — analyze_module + query_ast_symbol (departamento AST, camada sintática).
 *
 * Testa o motor puro (`analyzeSource`/`querySymbol`) e as tools via `handler`
 * (ToolResult, nunca lança). Fixture cobre imports (todas as formas), exports
 * (inline, `export {}`, `export * from`, `export default`), classes com
 * herança/decorators/abstract, interfaces, funções (decl + arrow), variáveis,
 * enums e type aliases.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ToolInvocation, ToolResult } from '@clover/contracts';

import { analyzeModuleTool, findDocumentationTool, findInheritanceTool, queryAstSymbolTool } from '../src/index.js';
import { analyzeSource, findDocumentation, findInheritance, querySymbol } from '../src/ast/parse.js';

const FIXTURE = `import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as path from 'node:path';
import './side-effect.js';

export interface Repo {
  url: string;
}

interface Internal extends Repo {
  secret: boolean;
}

export type Id = string | number;

export enum Color { Red, Green, Blue }

@Injectable()
export abstract class Base extends EventEmitter implements Repo, Disposable {
  url = '';
  private count = 0;

  @Get('/x')
  handle(req: string): void {}

  async load(): Promise<void> {}
}

export function greet(name: string, loud = false): string {
  return name;
}

export const add = async (a: number, b: number): Promise<number> => a + b;

const internalVar = 42;
export const API_KEY = 'k';

export { Internal };
export * from './other.js';
export default Base;
`;

describe('ast/ analyzeSource (motor puro)', () => {
  const a = analyzeSource('fixture.ts', FIXTURE);

  it('extrai imports em todas as formas', () => {
    expect(a.imports).toContainEqual({ module: 'node:fs', form: 'named', names: ['readFileSync'] });
    expect(a.imports).toContainEqual({ module: 'typescript', form: 'default', names: ['ts'] });
    expect(a.imports).toContainEqual({ module: 'node:path', form: 'namespace', names: ['path'] });
    expect(a.imports).toContainEqual({ module: './side-effect.js', form: 'side-effect', names: [] });
  });

  it('extrai exports inline, export{}, export * from e export default', () => {
    const byName = (n: string) => a.exports.filter((e) => e.name === n);
    expect(byName('Repo')[0]?.kind).toBe('interface');
    expect(byName('greet')[0]?.kind).toBe('function');
    expect(byName('add')[0]?.kind).toBe('function'); // arrow exportada conta como função
    expect(byName('API_KEY')[0]?.kind).toBe('variable');
    expect(byName('Internal')).toHaveLength(1); // export { Internal }
    expect(a.exports).toContainEqual({ name: '*', kind: 're-export', reexportFrom: './other.js' });
    expect(byName('default')[0]?.kind).toBe('default');
    // Internal NÃO tem modifier export inline → não vem como inline export.
    expect(a.interfaces.find((i) => i.name === 'Internal')?.exported).toBe(false);
  });

  it('classe: herança, implements, abstract, decorators, membros', () => {
    const base = a.classes.find((c) => c.name === 'Base')!;
    expect(base.exported).toBe(true);
    expect(base.abstract).toBe(true);
    expect(base.extends).toBe('EventEmitter');
    expect(base.implements).toEqual(['Repo', 'Disposable']);
    expect(base.decorators).toContain('Injectable');
    expect(base.methods).toEqual(expect.arrayContaining(['handle', 'load']));
    expect(base.properties).toEqual(expect.arrayContaining(['url', 'count']));
  });

  it('agrega decorators de classe e de membro (distintos, ordenados)', () => {
    expect(a.decorators).toEqual(['Get', 'Injectable']);
  });

  it('interfaces com extends, funções (async/params), enums, type aliases', () => {
    expect(a.interfaces.find((i) => i.name === 'Internal')?.extends).toEqual(['Repo']);
    const greet = a.functions.find((f) => f.name === 'greet')!;
    expect(greet.params).toEqual(['name', 'loud']);
    expect(greet.async).toBe(false);
    expect(a.functions.find((f) => f.name === 'add')?.async).toBe(true);
    expect(a.enums.find((e) => e.name === 'Color')?.members).toEqual(['Red', 'Green', 'Blue']);
    expect(a.typeAliases.find((t) => t.name === 'Id')?.exported).toBe(true);
    // variável interna não-exportada capturada como variable
    expect(a.variables.find((v) => v.name === 'internalVar')?.exported).toBe(false);
  });
});

describe('ast/ querySymbol (motor puro)', () => {
  it('encontra classe, método, função e retorna kind/linha/exported', () => {
    expect(querySymbol('f.ts', FIXTURE, 'Base')[0]).toMatchObject({ kind: 'class', exported: true });
    expect(querySymbol('f.ts', FIXTURE, 'handle')[0]).toMatchObject({ kind: 'method' });
    expect(querySymbol('f.ts', FIXTURE, 'greet')[0]).toMatchObject({ kind: 'function', exported: true });
  });

  it('símbolo inexistente → lista vazia', () => {
    expect(querySymbol('f.ts', FIXTURE, 'Nonexistent')).toEqual([]);
  });

  it('a assinatura é a primeira linha como escrita', () => {
    const greet = querySymbol('f.ts', FIXTURE, 'greet')[0]!;
    expect(greet.signature).toContain('function greet(');
  });
});

describe('ast/ tools (handler → ToolResult)', () => {
  let dir: string;

  function ctx(): ToolInvocation {
    return {
      taskId: 't', traceId: 'tr', workspacePath: dir,
      token: { id: 'k', taskId: 't', caps: [{ kind: 'fs.read', pathGlob: '**' }], issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sig: 't' },
      emit: () => {},
    };
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'clover-ast-'));
    writeFileSync(join(dir, 'mod.ts'), FIXTURE, 'utf8');
  });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('analyze_module lê o arquivo e retorna análise estruturada', async () => {
    const res = (await analyzeModuleTool.handler({ path: 'mod.ts' }, ctx())) as ToolResult;
    expect(res.success).toBe(true);
    const out = res.output as { path: string; classes: Array<{ name: string }>; functions: Array<{ name: string }> };
    expect(out.path).toBe('mod.ts');
    expect(out.classes.map((c) => c.name)).toContain('Base');
    expect(out.functions.map((f) => f.name)).toEqual(expect.arrayContaining(['greet', 'add']));
  });

  it('query_ast_symbol encontra e reporta found=true', async () => {
    const res = (await queryAstSymbolTool.handler({ path: 'mod.ts', name: 'Base' }, ctx())) as ToolResult;
    expect(res.success).toBe(true);
    const out = res.output as { found: boolean; matches: Array<{ kind: string }> };
    expect(out.found).toBe(true);
    expect(out.matches[0]?.kind).toBe('class');
  });

  it('extensão não suportada → { success:false } (nunca lança)', async () => {
    writeFileSync(join(dir, 'data.py'), 'print(1)\n', 'utf8');
    const res = (await analyzeModuleTool.handler({ path: 'data.py' }, ctx())) as ToolResult;
    expect(res.success).toBe(false);
    expect(res.error).toContain('não suportada');
  });

  it('caminho ABSOLUTO agora é permitido (The OS Explorer): lê o próprio fixture', async () => {
    // Fronteira de workspace removida para reads; passar o abs do mod.ts funciona.
    const abs = join(dir, 'mod.ts');
    const res = (await analyzeModuleTool.handler({ path: abs }, ctx())) as ToolResult;
    expect(res.success).toBe(true);
    expect((res.output as { classes: Array<{ name: string }> }).classes.map((c) => c.name)).toContain('Base');
  });

  it('arquivo inexistente → { success:false } (erro de I/O tratado)', async () => {
    const res = (await queryAstSymbolTool.handler({ path: 'missing.ts', name: 'X' }, ctx())) as ToolResult;
    expect(res.success).toBe(false);
  });
});

const DOC_FIXTURE = `/** O contrato do repositório. */
export interface Repo {
  url: string;
}

/**
 * Serviço principal.
 * Faz o trabalho pesado.
 */
export class Service {
  /** Carrega os dados. */
  load(): void {}

  noDoc(): void {}
}

/** Soma dois números. */
export function sum(a: number, b: number): number {
  return a + b;
}
`;

describe('ast/ findInheritance (motor puro)', () => {
  it('mapeia extends/implements de classes e interfaces', () => {
    const all = findInheritance('f.ts', FIXTURE);
    expect(all).toContainEqual({ name: 'Base', kind: 'class', extends: ['EventEmitter'], implements: ['Repo', 'Disposable'] });
    expect(all).toContainEqual({ name: 'Internal', kind: 'interface', extends: ['Repo'], implements: [] });
  });

  it('filtra por nome quando fornecido', () => {
    const only = findInheritance('f.ts', FIXTURE, 'Base');
    expect(only).toHaveLength(1);
    expect(only[0]?.name).toBe('Base');
  });
});

describe('ast/ findDocumentation (motor puro)', () => {
  it('extrai JSDoc de interface, classe, método e função', () => {
    expect(findDocumentation('d.ts', DOC_FIXTURE, 'Repo')[0]?.doc).toBe('O contrato do repositório.');
    expect(findDocumentation('d.ts', DOC_FIXTURE, 'Service')[0]?.doc).toContain('Serviço principal.');
    expect(findDocumentation('d.ts', DOC_FIXTURE, 'load')[0]?.doc).toBe('Carrega os dados.');
    expect(findDocumentation('d.ts', DOC_FIXTURE, 'sum')[0]?.doc).toBe('Soma dois números.');
  });

  it('símbolo sem JSDoc não aparece na saída', () => {
    expect(findDocumentation('d.ts', DOC_FIXTURE, 'noDoc')).toEqual([]);
  });
});

describe('ast/ novas tools (handler)', () => {
  let dir: string;
  function ctx(): ToolInvocation {
    return {
      taskId: 't', traceId: 'tr', workspacePath: dir,
      token: { id: 'k', taskId: 't', caps: [{ kind: 'fs.read', pathGlob: '**' }], issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sig: 't' },
      emit: () => {},
    };
  }
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'clover-ast2-'));
    writeFileSync(join(dir, 'mod.ts'), FIXTURE, 'utf8');
    writeFileSync(join(dir, 'doc.ts'), DOC_FIXTURE, 'utf8');
  });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('find_inheritance retorna entries estruturadas', async () => {
    const res = (await findInheritanceTool.handler({ path: 'mod.ts', name: 'Base' }, ctx())) as ToolResult;
    expect(res.success).toBe(true);
    const out = res.output as { entries: Array<{ name: string; extends: string[] }> };
    expect(out.entries[0]?.extends).toEqual(['EventEmitter']);
  });

  it('find_documentation retorna found=true + doc', async () => {
    const res = (await findDocumentationTool.handler({ path: 'doc.ts', name: 'sum' }, ctx())) as ToolResult;
    expect(res.success).toBe(true);
    const out = res.output as { found: boolean; docs: Array<{ doc: string }> };
    expect(out.found).toBe(true);
    expect(out.docs[0]?.doc).toBe('Soma dois números.');
  });

  it('find_documentation em símbolo sem doc → found=false', async () => {
    const res = (await findDocumentationTool.handler({ path: 'doc.ts', name: 'noDoc' }, ctx())) as ToolResult;
    expect(res.success).toBe(true);
    expect((res.output as { found: boolean }).found).toBe(false);
  });
});
