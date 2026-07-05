/**
 * sys/context — Contexto de sessão do agente GLOBAL (RAP: The OS Explorer).
 *
 * O CloverOS deixou de ser preso a um repositório: o agente navega o disco
 * inteiro. Este módulo guarda o **cwd de sessão** (as "pernas"): um override
 * global, mutável por `change_working_directory`, que o resolvedor de caminhos
 * usa como base quando presente.
 *
 * SEGURANÇA (mudança deliberada e autorizada): leitura/navegação são LIVRES em
 * qualquer caminho absoluto — a fronteira de workspace (`resolveInWorkspace`)
 * continua existindo só para o CACHE `.clover`. A trava real de mutação segue
 * sendo o Governor por `intent` (`write`/`destructive` pedem aprovação); reads
 * passam direto. Ninguém apaga nada sem confirmação — apenas o *ler/andar* é
 * global.
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Override global do cwd de sessão. `null` = usar o workspace da invocação. */
class SessionContext {
  private cwd: string | null = null;

  /** cwd de sessão vigente, ou `null` se nunca setado. */
  get(): string | null {
    return this.cwd;
  }

  /**
   * Aponta o agente para um novo diretório (absoluto). Valida existência +
   * tipo. Também move o `process.cwd()` (best-effort) para alinhar subprocessos.
   */
  set(absDir: string): string {
    const target = resolve(absDir);
    if (!existsSync(target)) throw new Error(`diretório não existe: ${absDir}`);
    if (!statSync(target).isDirectory()) throw new Error(`não é um diretório: ${absDir}`);
    this.cwd = target;
    try {
      process.chdir(target);
    } catch {
      /* best-effort: ambientes sem chdir não impedem o roaming lógico */
    }
    return target;
  }

  /** Limpa o override (testes / reset de sessão). */
  reset(): void {
    this.cwd = null;
  }
}

/** Singleton do cwd de sessão (as "pernas" do agente). */
export const session = new SessionContext();

/**
 * Sobe na árvore procurando um marcador de diretório (`.git`, `tsconfig.json`).
 * Retorna o diretório que o contém, ou `null`. É a semântica REAL de projeto:
 * um subdiretório de um repo git ainda é parte do repo.
 */
export function findUpwards(startDir: string, marker: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, marker))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // chegou na raiz
    dir = parent;
  }
}

/** Diretório raiz do repositório git que contém `dir`, ou `null`. */
export function findGitRoot(dir: string): string | null {
  return findUpwards(dir, '.git');
}

/** Diretório raiz do projeto TS (tem `tsconfig.json`) que contém `dir`, ou `null`. */
export function findTsProjectRoot(dir: string): string | null {
  return findUpwards(dir, 'tsconfig.json');
}
