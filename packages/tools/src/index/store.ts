/**
 * index/store — Persistência SQLite (sql.js/WASM) do Workspace Index.
 *
 * sql.js roda SQLite compilado para WebAssembly: **zero dependência nativa**
 * (mesmo motivo do `apps/backend`). É in-memory; persiste em disco via
 * `export()` → arquivo, e recarrega via `new Database(bytes)`. Este módulo é o
 * único que fala `sql.js` (chokepoint, espelhando `sys/fs` para `node:fs`).
 *
 * **Determinismo:** toda consulta tem `ORDER BY` explícito — a ordem de linhas do
 * SQLite é indefinida sem ela, e o mandato exige tools determinísticas.
 *
 * SRP: só armazenamento/consulta. Quem varre o workspace e extrai AST é o
 * `WorkspaceIndexer` (index/indexer.ts).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import initSqlJs, { type Database } from 'sql.js';

export interface FileMeta {
  path: string;
  /** mtime em ms (epoch) — base da invalidação incremental. */
  mtime: number;
  size: number;
}

export interface IndexedSymbol {
  path: string;
  name: string;
  kind: string;
  line: number;
  /** Última linha da declaração (null se o parser não informou). */
  endLine: number | null;
  exported: boolean;
  container: string | null;
}

export interface IndexedImport {
  path: string;
  /** Module specifier importado (ex.: `./util`, `node:fs`). */
  module: string;
  /** Identificadores importados, separados por vírgula. */
  names: string;
  line: number;
}

export interface IndexStats {
  files: number;
  symbols: number;
  imports: number;
}

/** Init do sql.js é caro (carrega WASM) — feito uma vez, reusado por todas as stores. */
let sqlModulePromise: ReturnType<typeof initSqlJs> | null = null;
function loadSql(): ReturnType<typeof initSqlJs> {
  if (!sqlModulePromise) sqlModulePromise = initSqlJs();
  return sqlModulePromise;
}

/**
 * Versão do schema. Em mismatch, as tabelas são dropadas e recriadas — o índice
 * é um CACHE reconstruível (a fonte da verdade é o código no disco), então
 * migração = reindexar, nunca perder dados do usuário.
 */
const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  path  TEXT PRIMARY KEY,
  mtime INTEGER NOT NULL,
  size  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS symbols (
  path      TEXT NOT NULL,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL,
  line      INTEGER NOT NULL,
  end_line  INTEGER,
  exported  INTEGER NOT NULL,
  container TEXT
);
CREATE TABLE IF NOT EXISTS imports (
  path   TEXT NOT NULL,
  module TEXT NOT NULL,
  names  TEXT NOT NULL,
  line   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_path ON symbols(path);
CREATE INDEX IF NOT EXISTS idx_imports_module ON imports(module);
CREATE INDEX IF NOT EXISTS idx_imports_path ON imports(path);
`;

/**
 * Store SQLite do índice. `open` é assíncrono (init do WASM); os demais métodos
 * são síncronos. `dbPath === ':memory:'` desativa a persistência em disco.
 */
export class WorkspaceIndexStore {
  private constructor(
    private readonly db: Database,
    private readonly dbPath: string,
  ) {}

  static async open(dbPath: string): Promise<WorkspaceIndexStore> {
    const SQL = await loadSql();
    let db: Database;
    if (dbPath !== ':memory:') {
      let bytes: Uint8Array | null = null;
      try {
        bytes = readFileSync(dbPath);
      } catch {
        bytes = null; // arquivo ainda não existe → base nova
      }
      db = new SQL.Database(bytes);
    } else {
      db = new SQL.Database();
    }
    // Migração por versão: cache reconstruível → drop + recreate em mismatch.
    const verRows = db.exec('PRAGMA user_version');
    const version = Number(verRows[0]?.values[0]?.[0] ?? 0);
    if (version !== SCHEMA_VERSION) {
      db.run('DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS symbols; DROP TABLE IF EXISTS imports;');
      db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    db.run(SCHEMA);
    return new WorkspaceIndexStore(db, dbPath);
  }

  /** Executa um SELECT e devolve linhas como objetos. */
  private queryAll(sql: string, params?: unknown[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql);
    try {
      if (params) stmt.bind(params);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  getFileMeta(path: string): FileMeta | undefined {
    const rows = this.queryAll('SELECT path, mtime, size FROM files WHERE path = ?', [path]);
    const r = rows[0];
    if (!r) return undefined;
    return { path: String(r.path), mtime: Number(r.mtime), size: Number(r.size) };
  }

  allFilePaths(): string[] {
    return this.queryAll('SELECT path FROM files ORDER BY path').map((r) => String(r.path));
  }

  /**
   * Substitui atomicamente a entrada de um arquivo: apaga símbolos/imports
   * antigos e regrava tudo (idempotente por `path`).
   */
  upsertFile(meta: FileMeta, symbols: IndexedSymbol[], imports: IndexedImport[]): void {
    this.db.run('DELETE FROM symbols WHERE path = ?', [meta.path]);
    this.db.run('DELETE FROM imports WHERE path = ?', [meta.path]);
    this.db.run('INSERT OR REPLACE INTO files (path, mtime, size) VALUES (?, ?, ?)', [
      meta.path,
      meta.mtime,
      meta.size,
    ]);
    for (const s of symbols) {
      this.db.run(
        'INSERT INTO symbols (path, name, kind, line, end_line, exported, container) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [s.path, s.name, s.kind, s.line, s.endLine, s.exported ? 1 : 0, s.container],
      );
    }
    for (const i of imports) {
      this.db.run('INSERT INTO imports (path, module, names, line) VALUES (?, ?, ?, ?)', [
        i.path,
        i.module,
        i.names,
        i.line,
      ]);
    }
  }

  removeFile(path: string): void {
    this.db.run('DELETE FROM files WHERE path = ?', [path]);
    this.db.run('DELETE FROM symbols WHERE path = ?', [path]);
    this.db.run('DELETE FROM imports WHERE path = ?', [path]);
  }

  /** Definições de símbolo com um dado nome (todas as ocorrências). Determinístico. */
  symbolsByName(name: string): IndexedSymbol[] {
    return this.queryAll(
      'SELECT path, name, kind, line, end_line, exported, container FROM symbols WHERE name = ? ORDER BY path, line',
      [name],
    ).map(rowToSymbol);
  }

  /** Todos os símbolos exportados do workspace. Determinístico. */
  exportedSymbols(): IndexedSymbol[] {
    return this.queryAll(
      'SELECT path, name, kind, line, end_line, exported, container FROM symbols WHERE exported = 1 ORDER BY path, line',
    ).map(rowToSymbol);
  }

  /** Símbolos de certos kinds (ex.: function/method p/ métricas de tamanho). Determinístico. */
  symbolsByKinds(kinds: string[]): IndexedSymbol[] {
    if (kinds.length === 0) return [];
    const placeholders = kinds.map(() => '?').join(',');
    return this.queryAll(
      `SELECT path, name, kind, line, end_line, exported, container FROM symbols WHERE kind IN (${placeholders}) ORDER BY path, line`,
      kinds,
    ).map(rowToSymbol);
  }

  /** Todos os imports do workspace (base do grafo de dependências). Determinístico. */
  allImports(): IndexedImport[] {
    return this.queryAll('SELECT path, module, names, line FROM imports ORDER BY path, line').map(
      rowToImport,
    );
  }

  /** Imports em um arquivo. Determinístico. */
  importsInFile(path: string): IndexedImport[] {
    return this.queryAll(
      'SELECT path, module, names, line FROM imports WHERE path = ? ORDER BY line',
      [path],
    ).map(rowToImport);
  }

  /**
   * Sites de import que referenciam `name` (via a lista `names` do import).
   * Match textual sobre a coluna `names` — casa nome exato entre vírgulas.
   * Determinístico.
   */
  importSitesReferencing(name: string): IndexedImport[] {
    return this.queryAll('SELECT path, module, names, line FROM imports ORDER BY path, line')
      .map(rowToImport)
      .filter((imp) => imp.names.split(',').map((n) => n.trim()).includes(name));
  }

  stats(): IndexStats {
    const one = (sql: string): number => Number(this.queryAll(sql)[0]?.n ?? 0);
    return {
      files: one('SELECT COUNT(*) AS n FROM files'),
      symbols: one('SELECT COUNT(*) AS n FROM symbols'),
      imports: one('SELECT COUNT(*) AS n FROM imports'),
    };
  }

  /** Serializa a base para o arquivo em disco (no-op se `:memory:`). */
  persist(): void {
    if (this.dbPath === ':memory:') return;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }

  close(): void {
    this.db.close();
  }
}

function rowToSymbol(r: Record<string, unknown>): IndexedSymbol {
  return {
    path: String(r.path),
    name: String(r.name),
    kind: String(r.kind),
    line: Number(r.line),
    endLine: r.end_line == null ? null : Number(r.end_line),
    exported: Number(r.exported) === 1,
    container: r.container == null ? null : String(r.container),
  };
}

function rowToImport(r: Record<string, unknown>): IndexedImport {
  return {
    path: String(r.path),
    module: String(r.module),
    names: String(r.names),
    line: Number(r.line),
  };
}
