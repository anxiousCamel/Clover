/**
 * ast/semantic — Motor Semântico (FASE 2). Prova central do mandato: resolução
 * por BINDING, não por string — `save()` na classe A jamais se confunde com
 * `save()` na classe B. Workspace temporário real; LanguageService cacheado com
 * invalidação por mtime (rename → find_references vê o novo estado).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolInvocation, ToolResult } from '@clover/contracts';

import {
  disposeAllLanguageServices,
  findCalleesTool,
  findCallersTool,
  findReferencesSemanticTool,
  renameSymbolSemanticTool,
  session,
} from '../src/index.js';

let dir: string;

function ctx(): ToolInvocation {
  return {
    taskId: 't', traceId: 'tr', workspacePath: dir,
    token: { id: 'k', taskId: 't', caps: [{ kind: 'fs.write', pathGlob: '**' }], issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sig: 't' },
    emit: () => {},
  };
}

async function call(tool: { handler: (a: unknown, c: ToolInvocation) => Promise<unknown> }, args: unknown): Promise<ToolResult> {
  return (await tool.handler(args, ctx())) as ToolResult;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clover-sem-'));
  // Guarda de contexto do motor semântico exige projeto TS.
  writeFileSync(join(dir, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
  writeFileSync(join(dir, 'a.ts'), [
    'export class A {',
    "  save(): string { return 'a'; }",
    '}',
  ].join('\n'));
  writeFileSync(join(dir, 'b.ts'), [
    'export class B {',
    "  save(): string { return 'b'; }",
    '}',
  ].join('\n'));
  writeFileSync(join(dir, 'use.ts'), [
    "import { A } from './a.js';",
    "import { B } from './b.js';",
    'export function useA(): string {',
    '  const a = new A();',
    '  return a.save();',
    '}',
    'export function useB(): string {',
    '  return new B().save();',
    '}',
    'export function main(): string {',
    '  return useA() + useB();',
    '}',
  ].join('\n'));
});

afterEach(() => {
  disposeAllLanguageServices(); // serviço não pode segurar snapshot entre workspaces temp
  session.reset(); // não vazar cwd de sessão entre testes
  if (dir) rmSync(dir, { recursive: true, force: true });
});

afterAll(() => disposeAllLanguageServices());

describe('find_references (semântico)', () => {
  it('A.save: acha definição + uso em use.ts e NÃO inclui B.save (binding, não string)', async () => {
    const res = await call(findReferencesSemanticTool, { path: 'a.ts', name: 'save' });
    expect(res.success).toBe(true);
    const out = res.output as { references: Array<{ path: string; line: number; isDefinition: boolean }> };

    const paths = out.references.map((r) => r.path);
    expect(paths).toContain('a.ts');
    expect(paths).toContain('use.ts');
    // PROVA CENTRAL: b.ts tem um save() homônimo — NUNCA pode aparecer.
    expect(paths).not.toContain('b.ts');
    // O uso em use.ts é a linha do a.save() (5), não a do new B().save() (8).
    const useRefs = out.references.filter((r) => r.path === 'use.ts');
    expect(useRefs.map((r) => r.line)).toEqual([5]);
  });

  it('símbolo inexistente → erro estruturado { success:false }', async () => {
    const res = await call(findReferencesSemanticTool, { path: 'a.ts', name: 'naoExiste' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('não encontrado');
  });

  it('múltiplas ocorrências sem line → erro pedindo desambiguação com candidatos', async () => {
    // use.ts tem dois identificadores 'save' (a.save e new B().save).
    const res = await call(findReferencesSemanticTool, { path: 'use.ts', name: 'save' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('desambigue');
    expect(res.error).toContain('linha 5');
    expect(res.error).toContain('linha 8');
  });

  it('desambiguado por line=8 → resolve para B.save (e não A.save)', async () => {
    const res = await call(findReferencesSemanticTool, { path: 'use.ts', name: 'save', line: 8 });
    expect(res.success).toBe(true);
    const out = res.output as { references: Array<{ path: string }> };
    const paths = out.references.map((r) => r.path);
    expect(paths).toContain('b.ts');
    expect(paths).not.toContain('a.ts');
  });
});

describe('find_callers / find_callees (call hierarchy)', () => {
  it('find_callers de useA → main (com a linha da chamada)', async () => {
    const res = await call(findCallersTool, { path: 'use.ts', name: 'useA' });
    expect(res.success).toBe(true);
    const out = res.output as { callers: Array<{ name: string; path: string; callLines: number[] }> };
    expect(out.callers).toHaveLength(1);
    expect(out.callers[0]?.name).toBe('main');
    expect(out.callers[0]?.callLines).toEqual([11]);
  });

  it('find_callees de main → useA e useB', async () => {
    const res = await call(findCalleesTool, { path: 'use.ts', name: 'main' });
    expect(res.success).toBe(true);
    const out = res.output as { callees: Array<{ name: string }> };
    expect(out.callees.map((c) => c.name).sort()).toEqual(['useA', 'useB']);
  });

  it('alvo que não é função → erro estruturado', async () => {
    // 'A' é classe — prepareCallHierarchy aceita classes; usar um alvo inválido real:
    const res = await call(findCallersTool, { path: 'use.ts', name: 'naoExiste' });
    expect(res.success).toBe(false);
  });
});

describe('rename_symbol (semântico, aplica com .bak)', () => {
  it('renomeia A.save→persist em a.ts + use.ts; B.save INTOCADO; .bak criados', async () => {
    const res = await call(renameSymbolSemanticTool, { path: 'a.ts', name: 'save', newName: 'persist' });
    expect(res.success).toBe(true);
    const out = res.output as { applied: boolean; files: Array<{ path: string; backup: string | null }>; totalReplacements: number };
    expect(out.applied).toBe(true);
    expect(out.totalReplacements).toBe(2); // definição + 1 uso
    expect(out.files.map((f) => f.path).sort()).toEqual(['a.ts', 'use.ts']);

    // Conteúdo: A renomeada, uso atualizado…
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toContain('persist(): string');
    expect(readFileSync(join(dir, 'use.ts'), 'utf8')).toContain('a.persist()');
    // …e o homônimo NÃO relacionado permanece EXATAMENTE como estava.
    expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toContain("save(): string { return 'b'; }");
    expect(readFileSync(join(dir, 'use.ts'), 'utf8')).toContain('new B().save()');

    // Backups .bak com o conteúdo ORIGINAL.
    expect(readFileSync(join(dir, 'a.ts.bak'), 'utf8')).toContain("save(): string { return 'a'; }");
    expect(readFileSync(join(dir, 'use.ts.bak'), 'utf8')).toContain('a.save()');
    expect(existsSync(join(dir, 'b.ts.bak'))).toBe(false); // não tocado → sem backup
  });

  it('dryRun lista arquivos sem aplicar nem criar .bak', async () => {
    const res = await call(renameSymbolSemanticTool, { path: 'a.ts', name: 'save', newName: 'persist', dryRun: true });
    const out = res.output as { applied: boolean; files: Array<{ backup: string | null }> };
    expect(out.applied).toBe(false);
    expect(out.files.every((f) => f.backup === null)).toBe(true);
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toContain('save()');
    expect(existsSync(join(dir, 'a.ts.bak'))).toBe(false);
  });

  it('newName inválido → erro estruturado sem tocar disco', async () => {
    const res = await call(renameSymbolSemanticTool, { path: 'a.ts', name: 'save', newName: '123-bad' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('identificador');
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toContain('save()');
  });

  it('invalidação por mtime: após rename, find_references vê o novo símbolo', async () => {
    await call(renameSymbolSemanticTool, { path: 'a.ts', name: 'save', newName: 'persist' });
    // Mesmo serviço cacheado — snapshots invalidam por mtime.
    const res = await call(findReferencesSemanticTool, { path: 'a.ts', name: 'persist' });
    expect(res.success).toBe(true);
    const out = res.output as { total: number };
    expect(out.total).toBe(2);
  });
});
