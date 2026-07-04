/**
 * fs/ patch_file — backup `.bak` obrigatório (mandato FS).
 *
 * Prova, chamando o handler da tool diretamente (intent=write; fs tools usam
 * node:fs sob a fronteira de workspace, o token não é consumido pelo handler):
 *   1. patch bem-sucedido cria `<path>.bak` com o conteúdo ORIGINAL;
 *   2. o output estruturado expõe `backup`, `path` e `replacements`;
 *   3. patch que não encontra o trecho NÃO cria backup (sem `.bak` espúrio) e
 *      retorna `{ success: false }` — nunca lança;
 *   4. `all` substitui todas as ocorrências e o backup preserva o original.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolInvocation, ToolResult } from '@clover/contracts';

import { patchFileTool } from '../src/index.js';

let dir: string;

/** ctx mínimo: fs tools só usam `workspacePath` (token não é consumido). */
function ctxFor(workspacePath: string): ToolInvocation {
  return {
    taskId: 't-patch',
    traceId: 'trace-patch',
    workspacePath,
    token: {
      id: 'tok', taskId: 't-patch', caps: [{ kind: 'fs.write', pathGlob: '**' }],
      issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sig: 'test',
    },
    emit: () => {},
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clover-patch-'));
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('patch_file — backup .bak', () => {
  it('patch bem-sucedido cria .bak com o conteúdo original', async () => {
    writeFileSync(join(dir, 'code.ts'), 'const x = 1;\n', 'utf8');

    const res = (await patchFileTool.handler(
      { path: 'code.ts', search: 'const x = 1;', replace: 'const x = 2;' },
      ctxFor(dir),
    )) as ToolResult;

    expect(res.success).toBe(true);
    const out = res.output as { path: string; replacements: number; backup: string };
    expect(out.path).toBe('code.ts');
    expect(out.replacements).toBe(1);
    expect(out.backup).toBe('code.ts.bak');

    // Arquivo patchado tem o novo conteúdo…
    expect(readFileSync(join(dir, 'code.ts'), 'utf8')).toBe('const x = 2;\n');
    // …e o backup preserva o ORIGINAL byte-a-byte.
    expect(readFileSync(join(dir, 'code.ts.bak'), 'utf8')).toBe('const x = 1;\n');
  });

  it('trecho não encontrado → { success:false } e NENHUM .bak criado', async () => {
    writeFileSync(join(dir, 'code.ts'), 'const x = 1;\n', 'utf8');

    const res = (await patchFileTool.handler(
      { path: 'code.ts', search: 'NAO_EXISTE', replace: 'x' },
      ctxFor(dir),
    )) as ToolResult;

    expect(res.success).toBe(false);
    expect(res.error).toContain('não encontrado');
    // Arquivo intacto e sem backup espúrio.
    expect(readFileSync(join(dir, 'code.ts'), 'utf8')).toBe('const x = 1;\n');
    expect(existsSync(join(dir, 'code.ts.bak'))).toBe(false);
  });

  it('all=true substitui todas as ocorrências; backup preserva o original', async () => {
    writeFileSync(join(dir, 'multi.txt'), 'a a a\n', 'utf8');

    const res = (await patchFileTool.handler(
      { path: 'multi.txt', search: 'a', replace: 'b', all: true },
      ctxFor(dir),
    )) as ToolResult;

    expect(res.success).toBe(true);
    const out = res.output as { replacements: number; backup: string };
    expect(out.replacements).toBe(3);
    expect(readFileSync(join(dir, 'multi.txt'), 'utf8')).toBe('b b b\n');
    expect(readFileSync(join(dir, 'multi.txt.bak'), 'utf8')).toBe('a a a\n');
  });

  it('backup fica DENTRO do workspace (mesma fronteira da escrita principal)', async () => {
    writeFileSync(join(dir, 'nested-code.ts'), 'foo\n', 'utf8');

    // path com subdiretório: o .bak acompanha o arquivo, sob a fronteira.
    const res = (await patchFileTool.handler(
      { path: 'nested-code.ts', search: 'foo', replace: 'bar' },
      ctxFor(dir),
    )) as ToolResult;

    expect(res.success).toBe(true);
    expect(existsSync(join(dir, 'nested-code.ts.bak'))).toBe(true);
  });
});
