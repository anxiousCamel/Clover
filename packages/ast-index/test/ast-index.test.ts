/**
 * AST Index — extração estrutural via TypeScript Compiler API.
 */

import { describe, expect, it } from 'vitest';

import { AstIndex, TypeScriptAstParser } from '@clover/ast-index';

const SAMPLE = `
import { readFile } from 'node:fs';
import ts from 'typescript';
import * as path from 'node:path';

export interface Options { verbose: boolean; }
export type Id = string;
export enum Color { Red, Green }

export function greet(name: string): string {
  return 'hi ' + name;
}

const internalConst = 42;

export class Service {
  run(): void {}
  stop(): void {}
}
`;

describe('TypeScriptAstParser / AstIndex', () => {
  it('extracts symbols with kinds, export flags and method containers', () => {
    const index = new AstIndex(new TypeScriptAstParser());
    index.indexFile('src/service.ts', SAMPLE);

    const byName = (n: string) => index.findSymbol(n)[0];

    expect(byName('greet')).toMatchObject({ kind: 'function', exported: true });
    expect(byName('Service')).toMatchObject({ kind: 'class', exported: true });
    expect(byName('Options')).toMatchObject({ kind: 'interface', exported: true });
    expect(byName('Id')).toMatchObject({ kind: 'type', exported: true });
    expect(byName('Color')).toMatchObject({ kind: 'enum', exported: true });
    expect(byName('internalConst')).toMatchObject({ kind: 'variable', exported: false });

    // métodos têm o container (classe)
    const run = byName('run');
    expect(run).toMatchObject({ kind: 'method', container: 'Service' });
    expect(index.findSymbol('stop')[0].container).toBe('Service');
  });

  it('captures imports (default, namespace and named)', () => {
    const index = new AstIndex();
    const ast = index.indexFile('src/service.ts', SAMPLE)!;

    const froms = ast.imports.map((i) => i.from);
    expect(froms).toContain('node:fs');
    expect(froms).toContain('typescript');

    const fs = ast.imports.find((i) => i.from === 'node:fs')!;
    expect(fs.names).toContain('readFile');
    const tsImp = ast.imports.find((i) => i.from === 'typescript')!;
    expect(tsImp.names).toContain('ts'); // default
    const pathImp = ast.imports.find((i) => i.from === 'node:path')!;
    expect(pathImp.names).toContain('* as path'); // namespace
  });

  it('ignores unsupported file types and supports re-indexing', () => {
    const index = new AstIndex();
    expect(index.indexFile('readme.md', '# hi')).toBeUndefined();
    expect(index.fileCount).toBe(0);

    index.indexFile('a.ts', 'export const x = 1;');
    expect(index.findSymbol('x')).toHaveLength(1);
    index.indexFile('a.ts', 'export const y = 2;'); // reindexa
    expect(index.findSymbol('x')).toHaveLength(0);
    expect(index.findSymbol('y')).toHaveLength(1);
  });

  it('reports line numbers (1-based)', () => {
    const index = new AstIndex();
    index.indexFile('a.ts', 'export function greet() {}');
    expect(index.findSymbol('greet')[0].line).toBe(1);
  });
});
