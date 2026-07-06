/**
 * Namespace `fs/` — Departamento de Fundação (acesso a disco GLOBAL).
 *
 * The OS Explorer: o agente lê/anda por QUALQUER diretório da máquina. Leitura e
 * navegação são `read` (livres, sem prompt); escrita/patch são `write` (o
 * Governor pede aprovação). Caminhos podem ser relativos (ao cwd de sessão) ou
 * ABSOLUTOS — `resolveGlobal` não confina ao workspace. A antiga fronteira
 * (`resolveInWorkspace`) sobrevive só para o cache `.clover`.
 */

import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import type { CapabilityRequest, ToolInvocation } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';
import { z } from 'zod';

import { defineZodTool } from '../abi.js';
import { session } from '../sys/context.js';
import {
  baseDir,
  readLinesPaginated,
  readTextGlobal,
  resolveGlobal,
  writeTextGlobal,
} from '../sys/fs.js';

const FS_READ: CapabilityRequest[] = [{ kind: 'fs.read' }];
const FS_WRITE: CapabilityRequest[] = [{ kind: 'fs.write' }];

// ===========================================================================
// read_file_paginated
// ===========================================================================

export const readFilePaginatedTool: LocalTool = defineZodTool({
  name: 'read_file_paginated',
  description:
    'Lê um arquivo por páginas (offset/limit de linhas) via streaming — seguro para arquivos grandes, não estoura tokens. Caminho relativo (ao diretório atual) ou ABSOLUTO. Retorna linhas numeradas e o próximo offset.',
  input: z
    .object({
      path: z.string().min(1).describe('Caminho do arquivo — relativo ao dir atual ou absoluto.'),
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
    const abs = resolveGlobal(ctx, args.path);
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
    'Escreve (cria/sobrescreve) um arquivo, criando diretórios pais. Caminho relativo (ao dir atual) ou ABSOLUTO. Operação de ESCRITA — exige autorização.',
  input: z
    .object({
      path: z.string().min(1).describe('Caminho do arquivo — relativo ao dir atual ou absoluto.'),
      content: z.string().describe('Conteúdo completo do arquivo.'),
    })
    .strict(),
  output: z.object({ path: z.string(), bytes: z.number() }),
  capabilities: FS_WRITE,
  intent: 'write',
  pure: false,
  run: (args, ctx) => {
    const bytes = writeTextGlobal(ctx, args.path, args.content);
    return { path: args.path, bytes };
  },
});

// ===========================================================================
// patch_file
// ===========================================================================

export const patchFileTool: LocalTool = defineZodTool({
  name: 'patch_file',
  description:
    'Edição cirúrgica por search/replace (literal) — modifica lógica sem reescrever o arquivo inteiro (economiza orçamento). Cria backup `.bak` antes de sobrescrever. Operação de ESCRITA.',
  input: z
    .object({
      path: z.string().min(1),
      search: z.string().min(1).describe('Trecho literal a localizar.'),
      replace: z.string().describe('Substituição.'),
      all: z.boolean().optional().describe('Substituir todas as ocorrências (default: só a primeira).'),
    })
    .strict(),
  output: z.object({
    path: z.string(),
    replacements: z.number(),
    /** Caminho relativo do backup `.bak` criado antes da sobrescrita. */
    backup: z.string(),
  }),
  capabilities: FS_WRITE,
  intent: 'write',
  pure: false,
  run: (args, ctx) => {
    const original = readTextGlobal(ctx, args.path);
    const count = countOccurrences(original, args.search);
    if (count === 0) {
      // Falha ANTES de tocar o disco — nenhum backup espúrio em patch malsucedido.
      throw new Error(`patch_file: trecho não encontrado em '${args.path}'`);
    }
    const replacements = args.all ? count : 1;
    const patched = args.all
      ? original.split(args.search).join(args.replace)
      : original.replace(args.search, args.replace);
    // Backup obrigatório do conteúdo ORIGINAL antes de sobrescrever (mandato FS).
    // Escrito só após o check acima — patch válido garantido. Mesmo caminho
    // global (`resolveGlobal`) da escrita principal.
    const backup = `${args.path}.bak`;
    writeTextGlobal(ctx, backup, original);
    writeTextGlobal(ctx, args.path, patched);
    return { path: args.path, replacements, backup };
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

// ===========================================================================
// Listagem de diretório (motor compartilhado por list_files / list_directory)
// ===========================================================================

/** Diretórios ruidosos omitidos por padrão na RECURSÃO (não no nível pedido). */
const LIST_SKIP = new Set(['.git', 'node_modules', 'dist', '.clover', 'coverage']);

interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
}

const DirEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'dir']),
  size: z.number().describe('Bytes (0 para diretórios).'),
});

/** Walk iterativo de `absBase`; `displayBase` prefixa os paths retornados. */
function walkDir(
  absBase: string,
  displayBase: string,
  recursive: boolean,
  cap: number,
): { entries: DirEntry[]; truncated: boolean } {
  const entries: DirEntry[] = [];
  let truncated = false;
  const stack: Array<{ abs: string; rel: string }> = [{ abs: absBase, rel: '' }];
  let firstDir = true;

  while (stack.length > 0) {
    const { abs, rel } = stack.pop() as { abs: string; rel: string };
    let dirents;
    try {
      dirents = readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      if (firstDir) {
        // Erro no diretório-alvo → propaga (vira { success:false }).
        throw new Error(`não foi possível ler '${displayBase}': ${err instanceof Error ? err.message : String(err)}`);
      }
      continue; // subdiretório sem permissão → ignora
    }
    firstDir = false;
    for (const d of [...dirents].sort((a, b) => a.name.localeCompare(b.name))) {
      if (entries.length >= cap) {
        truncated = true;
        break;
      }
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        entries.push({ name: d.name, path: childRel, type: 'dir', size: 0 });
        if (recursive && !LIST_SKIP.has(d.name)) stack.push({ abs: join(abs, d.name), rel: childRel });
      } else if (d.isFile()) {
        let size = 0;
        try {
          size = statSync(join(abs, d.name)).size;
        } catch {
          /* removido em corrida — tamanho 0 */
        }
        entries.push({ name: d.name, path: childRel, type: 'file', size });
      }
    }
    if (truncated) break;
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, truncated };
}

const ListInput = z
  .object({
    path: z.string().optional().describe('Diretório — relativo ao dir atual ou ABSOLUTO (default: dir atual).'),
    recursive: z.boolean().optional().describe('Descer em subdiretórios (default: só o nível pedido).'),
    maxResults: z.number().int().min(1).max(5000).optional().describe('Teto de entradas (default 500).'),
  })
  .strict();

const ListOutput = z.object({
  path: z.string(),
  entries: z.array(DirEntrySchema),
  total: z.number(),
  truncated: z.boolean(),
});

function runList(args: { path?: string; recursive?: boolean; maxResults?: number }, ctx: ToolInvocation) {
  const absBase = resolveGlobal(ctx, args.path);
  const { entries, truncated } = walkDir(absBase, args.path ?? absBase, args.recursive ?? false, args.maxResults ?? 500);
  return { path: absBase, entries, total: entries.length, truncated };
}

export const listFilesTool: LocalTool = defineZodTool({
  name: 'list_files',
  description:
    'Lista arquivos e pastas de um diretório: nome, tipo e tamanho. USE ESTA para listar, explorar, ver ou navegar arquivos e diretórios. Caminho relativo ou absoluto. Somente leitura.',
  input: ListInput,
  output: ListOutput,
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: runList,
});

// ===========================================================================
// list_directory (mobilidade — olhos)
// ===========================================================================

export const listDirectoryTool: LocalTool = defineZodTool({
  name: 'list_directory',
  description:
    'Lista o conteúdo de um diretório (arquivos/pastas com tipo e tamanho). Aceita caminho relativo ao dir atual ou ABSOLUTO; sem path, usa o diretório atual. Navegação global read-only.',
  input: ListInput,
  output: ListOutput,
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: runList,
});

// ===========================================================================
// get_current_directory (mobilidade — onde estou)
// ===========================================================================

export const getCurrentDirectoryTool: LocalTool = defineZodTool({
  name: 'get_current_directory',
  description:
    'Retorna o caminho do diretório atual (CWD) onde o agente está posicionado. Consulta de posição — use antes de operar com caminhos relativos.',
  input: z.object({}).strict(),
  output: z.object({ cwd: z.string(), roaming: z.boolean().describe('true se movido por change_working_directory.') }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (_args, ctx) => ({ cwd: baseDir(ctx), roaming: session.get() !== null }),
});

// ===========================================================================
// change_working_directory (mobilidade — pernas)
// ===========================================================================

export const changeWorkingDirectoryTool: LocalTool = defineZodTool({
  name: 'change_working_directory',
  description:
    'Move o agente para outro diretório (as "pernas"): atualiza o CWD de sessão e o process.cwd(). Caminhos seguintes passam a resolver a partir daqui. Aceita relativo ou ABSOLUTO. Navegação livre (não destrutiva).',
  input: z.object({ path: z.string().min(1).describe('Diretório destino — relativo ao atual ou absoluto.') }).strict(),
  output: z.object({ cwd: z.string(), previous: z.string() }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) => {
    const previous = baseDir(ctx);
    const target = resolveGlobal(ctx, args.path);
    const cwd = session.set(target); // valida existência/tipo; move process.cwd()
    return { cwd, previous };
  },
});

// ===========================================================================
// open_file — abre no app padrão do OS
// ===========================================================================

export const openFileTool: LocalTool = defineZodTool({
  name: 'open_file',
  description:
    'Abre um arquivo ou pasta no aplicativo padrão do sistema operacional. ' +
    'Funciona com QUALQUER tipo: .pcap/.pcapng (Wireshark), .pdf, .xlsx, .zip, .exe, .dll, pastas (Explorer), imagens, vídeos, etc. ' +
    'O OS escolhe o app — não requer saber qual programa usar.',
  input: z
    .object({
      path: z.string().min(1).describe('Caminho do arquivo ou pasta — relativo ao dir atual ou ABSOLUTO.'),
    })
    .strict(),
  output: z.object({
    path: z.string(),
    opened: z.boolean(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) => {
    const abs = resolveGlobal(ctx, args.path);
    try {
      statSync(abs);
    } catch {
      throw new Error(`open_file: '${args.path}' não encontrado`);
    }
    let child;
    if (process.platform === 'win32') {
      // start "" "<path>" — aspas vazias = título vazio; evita engolir o path
      child = spawn('cmd', ['/c', 'start', '', abs], { detached: true, stdio: 'ignore', shell: false });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [abs], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [abs], { detached: true, stdio: 'ignore' });
    }
    child.unref(); // não bloqueia o processo Node
    return { path: abs, opened: true };
  },
});

/** Todas as tools do namespace fs/. */
export const fsTools: LocalTool[] = [
  readFilePaginatedTool,
  writeFileTool,
  patchFileTool,
  listFilesTool,
  listDirectoryTool,
  getCurrentDirectoryTool,
  changeWorkingDirectoryTool,
  openFileTool,
];
