/**
 * sys/fs — Chokepoint ÚNICO de acesso a disco das tools.
 *
 * Assim como `ProcessSandbox` é o único ponto que fala `child_process`, este é o
 * único que fala `node:fs`. Toda leitura/escrita passa por `resolveInWorkspace`,
 * que aplica a MESMA fronteira canônica do Sandbox (resolve + `startsWith(ws +
 * sep)`), barrando escape por `..` ou caminho absoluto. Herda a limitação de
 * symlink do Sandbox (não faz `realpath`) — documentado, não meio-resolvido.
 *
 * "Proibido acesso direto a disco" = proibido acesso *não-guardado*. Escritas
 * ainda exigem autorização do Governor (intent `write`) na camada do Executor.
 */

import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';

import type { ToolInvocation } from '@clover/contracts';

import { session } from './context.js';

export class FsBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FsBoundaryError';
  }
}

/**
 * Resolve `rel` dentro do workspace; lança `FsBoundaryError` se escapar. USADO
 * SÓ pelo cache `.clover` (índice/knowledge/research) — a única coisa que ainda
 * DEVE ficar confinada. Ferramentas de FS de usuário usam `resolveGlobal`.
 */
export function resolveInWorkspace(ctx: ToolInvocation, rel: string): string {
  const ws = resolve(ctx.workspacePath);
  const target = resolve(ws, rel); // rel absoluto → target não começa com ws → barrado
  if (target !== ws && !target.startsWith(ws + sep)) {
    throw new FsBoundaryError(`caminho fora do workspace: ${rel}`);
  }
  return target;
}

/**
 * Base de resolução do agente GLOBAL: o cwd de sessão (roaming) se setado,
 * senão o workspace da invocação. É o "onde estou" das pernas do agente.
 */
export function baseDir(ctx: ToolInvocation): string {
  return session.get() ?? resolve(ctx.workspacePath);
}

/**
 * Resolve um caminho GLOBALMENTE (The OS Explorer): absoluto passa direto,
 * relativo resolve contra `baseDir`. SEM fronteira — o agente pode ler/andar
 * por qualquer diretório da máquina (autorizado). A trava de *mutação* segue no
 * Governor (intent). `path` ausente/`.` → o próprio diretório atual.
 */
export function resolveGlobal(ctx: ToolInvocation, path?: string): string {
  const base = baseDir(ctx);
  return path && path !== '.' ? resolve(base, path) : base;
}

/** Lê um arquivo inteiro (texto) por caminho global. Usado por patch. */
export function readTextGlobal(ctx: ToolInvocation, path: string): string {
  return readFileSync(resolveGlobal(ctx, path), 'utf8');
}

/** Escreve um arquivo (criando diretórios pais) por caminho global. */
export function writeTextGlobal(ctx: ToolInvocation, path: string, content: string): number {
  const abs = resolveGlobal(ctx, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return Buffer.byteLength(content, 'utf8');
}

export interface NumberedLine {
  n: number;
  text: string;
}

export interface PaginatedLines {
  lines: NumberedLine[];
  /** `true` se o arquivo terminou dentro da janela pedida. */
  eof: boolean;
  /** Offset (1-based) para a próxima página, ou `null` se `eof`. */
  nextOffset: number | null;
}

/**
 * Lê `limit` linhas a partir de `offset` (1-based) por **streaming**, encerrando
 * assim que passa da janela — não carrega o arquivo inteiro (protege memória e
 * orçamento de tokens).
 */
export async function readLinesPaginated(
  absPath: string,
  offset: number,
  limit: number,
): Promise<PaginatedLines> {
  const end = offset + limit; // exclusivo
  const out: NumberedLine[] = [];
  let n = 0;
  let eof = true;

  const rl = createInterface({
    input: createReadStream(absPath, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  try {
    for await (const line of rl) {
      n++;
      if (n < offset) continue;
      if (n < end) {
        out.push({ n, text: line });
      } else {
        // Existe pelo menos a linha #end → há mais além da janela.
        eof = false;
        break;
      }
    }
  } finally {
    rl.close();
  }

  return { lines: out, eof, nextOffset: eof ? null : end };
}

/** Lê um arquivo inteiro (texto) dentro da fronteira. Usado por patch. */
export function readTextInWorkspace(ctx: ToolInvocation, rel: string): string {
  return readFileSync(resolveInWorkspace(ctx, rel), 'utf8');
}

/** Escreve um arquivo (criando diretórios pais) dentro da fronteira. */
export function writeTextInWorkspace(ctx: ToolInvocation, rel: string, content: string): number {
  const abs = resolveInWorkspace(ctx, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return Buffer.byteLength(content, 'utf8');
}
