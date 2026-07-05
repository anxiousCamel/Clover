/**
 * fs/ GLOBAL — The OS Explorer. Prova a quebra do sandbox de leitura/navegação:
 * caminhos absolutos são aceitos, `change_working_directory` move o agente, e as
 * tools que dependem de git/AST validam o contexto (guiando de volta às FS tools
 * quando o diretório não é repo/projeto).
 *
 * Isolamento: `session.reset()` + restauração do process.cwd() em cada teste —
 * o cwd de sessão é singleton de módulo.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolInvocation, ToolResult } from '@clover/contracts';

import {
  changeWorkingDirectoryTool,
  getCurrentDirectoryTool,
  gitStatusTool,
  listDirectoryTool,
  readFilePaginatedTool,
  session,
} from '../src/index.js';

let dirA: string;
let dirB: string;
const originalCwd = process.cwd();

function ctx(workspacePath: string): ToolInvocation {
  return {
    taskId: 't', traceId: 'tr', workspacePath,
    token: { id: 'k', taskId: 't', caps: [{ kind: 'fs.read', pathGlob: '**' }], issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sig: 't' },
    emit: () => {},
  };
}

async function call(tool: { handler: (a: unknown, c: ToolInvocation) => Promise<unknown> }, args: unknown, ws: string): Promise<ToolResult> {
  return (await tool.handler(args, ctx(ws))) as ToolResult;
}

beforeEach(() => {
  dirA = mkdtempSync(join(tmpdir(), 'clover-osA-'));
  dirB = mkdtempSync(join(tmpdir(), 'clover-osB-'));
  writeFileSync(join(dirA, 'a.txt'), 'sou A\n');
  mkdirSync(join(dirB, 'sub'));
  writeFileSync(join(dirB, 'sub', 'b.txt'), 'sou B\n');
});

afterEach(() => {
  session.reset();
  try { process.chdir(originalCwd); } catch { /* ignore */ }
  for (const d of [dirA, dirB]) if (d) rmSync(d, { recursive: true, force: true });
});

describe('fs/ global — leitura sem fronteira', () => {
  it('read_file_paginated aceita caminho ABSOLUTO fora do workspace', async () => {
    // workspace = dirB, mas leio um arquivo em dirA por caminho absoluto.
    const res = await call(readFilePaginatedTool, { path: join(dirA, 'a.txt') }, dirB);
    expect(res.success).toBe(true);
    expect((res.output as { lines: Array<{ text: string }> }).lines[0]?.text).toBe('sou A');
  });

  it('list_directory sem path lista o diretório atual (workspace)', async () => {
    const res = await call(listDirectoryTool, {}, dirA);
    expect(res.success).toBe(true);
    const out = res.output as { path: string; entries: Array<{ name: string }> };
    expect(out.path).toBe(resolve(dirA));
    expect(out.entries.map((e) => e.name)).toContain('a.txt');
  });

  it('list_directory com caminho ABSOLUTO lista outro diretório da máquina', async () => {
    const res = await call(listDirectoryTool, { path: dirB, recursive: true }, dirA);
    const out = res.output as { entries: Array<{ path: string }> };
    expect(out.entries.map((e) => e.path)).toContain('sub/b.txt');
  });
});

describe('fs/ mobilidade — pernas do agente', () => {
  it('get_current_directory reporta cwd e roaming=false por padrão', async () => {
    const res = await call(getCurrentDirectoryTool, {}, dirA);
    const out = res.output as { cwd: string; roaming: boolean };
    expect(out.cwd).toBe(resolve(dirA));
    expect(out.roaming).toBe(false);
  });

  it('change_working_directory move a base; resoluções relativas seguintes usam o novo dir', async () => {
    const cd = await call(changeWorkingDirectoryTool, { path: dirB }, dirA);
    expect(cd.success).toBe(true);
    const cdOut = cd.output as { cwd: string; previous: string };
    expect(cdOut.cwd).toBe(resolve(dirB));
    expect(cdOut.previous).toBe(resolve(dirA));

    // Agora, mesmo com ctx.workspacePath=dirA, o relativo resolve contra dirB.
    const g = await call(getCurrentDirectoryTool, {}, dirA);
    expect((g.output as { cwd: string; roaming: boolean }).roaming).toBe(true);
    const ls = await call(listDirectoryTool, { path: 'sub' }, dirA);
    expect((ls.output as { entries: Array<{ name: string }> }).entries.map((e) => e.name)).toContain('b.txt');
  });

  it('change_working_directory para diretório inexistente → { success:false }', async () => {
    const res = await call(changeWorkingDirectoryTool, { path: join(dirA, 'nao-existe') }, dirA);
    expect(res.success).toBe(false);
    expect(res.error).toContain('não existe');
  });
});

describe('fs/ resiliência de contexto — fim da alucinação git', () => {
  it('git_status em diretório NÃO-git → erro guiado para FS tools', async () => {
    // dirA não tem .git.
    const res = await call(gitStatusTool, {}, dirA);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Not a git repository');
    expect(res.error).toContain('FS tools');
  });
});
