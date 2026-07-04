/**
 * Namespace `fs/` — Departamento de Fundação (acesso a disco).
 *
 * Leitura é `read` (sem trava); escrita/patch são `write` (exigem autorização do
 * Governor). Todo acesso passa pelo chokepoint `sys/fs` (fronteira de workspace).
 * As tools declaram `fs.read`/`fs.write` (capability) além do `intent` — os dois
 * andam juntos.
 */

import type { CapabilityRequest } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';
import { z } from 'zod';

import { defineZodTool } from '../abi.js';
import { readLinesPaginated, readTextInWorkspace, resolveInWorkspace, writeTextInWorkspace } from '../sys/fs.js';

const FS_READ: CapabilityRequest[] = [{ kind: 'fs.read' }];
const FS_WRITE: CapabilityRequest[] = [{ kind: 'fs.write' }];

// ===========================================================================
// read_file_paginated
// ===========================================================================

export const readFilePaginatedTool: LocalTool = defineZodTool({
  name: 'read_file_paginated',
  description:
    'Lê um arquivo por páginas (offset/limit de linhas) via streaming — seguro para arquivos grandes, não estoura tokens. Retorna linhas numeradas e o próximo offset.',
  input: z
    .object({
      path: z.string().min(1).describe('Caminho relativo ao workspace.'),
      offset: z.number().int().min(1).optional().describe('Linha inicial 1-based (default 1).'),
      limit: z.number().int().min(1).max(2000).optional().describe('Máx. de linhas (default 200).'),
    })
    .strict(),
  output: z.object({
    path: z.string(),
    lines: z.array(z.object({ n: z.number(), text: z.string() })),
    totalReturned: z.number(),
    offset: z.number(),
    nextOffset: z.number().nullable(),
    eof: z.boolean(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: async (args, ctx) => {
    const offset = args.offset ?? 1;
    const limit = args.limit ?? 200;
    const abs = resolveInWorkspace(ctx, args.path);
    const page = await readLinesPaginated(abs, offset, limit);
    return {
      path: args.path,
      lines: page.lines,
      totalReturned: page.lines.length,
      offset,
      nextOffset: page.nextOffset,
      eof: page.eof,
    };
  },
});

// ===========================================================================
// write_file
// ===========================================================================

export const writeFileTool: LocalTool = defineZodTool({
  name: 'write_file',
  description:
    'Escreve (cria/sobrescreve) um arquivo no workspace. Operação de ESCRITA — exige autorização.',
  input: z
    .object({
      path: z.string().min(1).describe('Caminho relativo ao workspace.'),
      content: z.string().describe('Conteúdo completo do arquivo.'),
    })
    .strict(),
  output: z.object({ path: z.string(), bytes: z.number() }),
  capabilities: FS_WRITE,
  intent: 'write',
  pure: false,
  run: (args, ctx) => {
    const bytes = writeTextInWorkspace(ctx, args.path, args.content);
    return { path: args.path, bytes };
  },
});

// ===========================================================================
// patch_file
// ===========================================================================

export const patchFileTool: LocalTool = defineZodTool({
  name: 'patch_file',
  description:
    'Edição cirúrgica por search/replace (literal) — modifica lógica sem reescrever o arquivo inteiro (economiza orçamento). Operação de ESCRITA.',
  input: z
    .object({
      path: z.string().min(1),
      search: z.string().min(1).describe('Trecho literal a localizar.'),
      replace: z.string().describe('Substituição.'),
      all: z.boolean().optional().describe('Substituir todas as ocorrências (default: só a primeira).'),
    })
    .strict(),
  output: z.object({ path: z.string(), replacements: z.number() }),
  capabilities: FS_WRITE,
  intent: 'write',
  pure: false,
  run: (args, ctx) => {
    const original = readTextInWorkspace(ctx, args.path);
    const count = countOccurrences(original, args.search);
    if (count === 0) {
      throw new Error(`patch_file: trecho não encontrado em '${args.path}'`);
    }
    const replacements = args.all ? count : 1;
    const patched = args.all
      ? original.split(args.search).join(args.replace)
      : original.replace(args.search, args.replace);
    writeTextInWorkspace(ctx, args.path, patched);
    return { path: args.path, replacements };
  },
});

/** Conta ocorrências literais (sem regex) de `needle` em `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    count++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return count;
}

/** Todas as tools do namespace fs/. */
export const fsTools: LocalTool[] = [readFilePaginatedTool, writeFileTool, patchFileTool];
