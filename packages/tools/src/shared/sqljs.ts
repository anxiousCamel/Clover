/**
 * shared/sqljs — Carregamento único do sql.js (SQLite/WASM) para todo o pacote.
 *
 * O init do WASM é caro; este singleton é compartilhado por todas as stores
 * (Workspace Index, Knowledge Base, ...). Zero dependência nativa.
 */

import initSqlJs from 'sql.js';

let sqlModulePromise: ReturnType<typeof initSqlJs> | null = null;

/** Retorna a promise única do módulo sql.js inicializado. */
export function loadSql(): ReturnType<typeof initSqlJs> {
  if (!sqlModulePromise) sqlModulePromise = initSqlJs();
  return sqlModulePromise;
}
