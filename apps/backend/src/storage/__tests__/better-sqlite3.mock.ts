/**
 * A mock for `better-sqlite3` that uses `sql.js` (pure JS SQLite)
 * to provide the same API surface used by SQLiteStore.
 *
 * This allows tests to run without native compilation of better-sqlite3.
 */
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

export async function initMock(): Promise<void> {
  SQL = await initSqlJs();
}

class MockStatement {
  private db: SqlJsDatabase;
  private sql: string;

  constructor(db: SqlJsDatabase, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  run(...params: unknown[]): { changes: number } {
    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    this.db.run(this.sql, flatParams as (string | number | null | Uint8Array)[]);
    return { changes: this.db.getRowsModified() };
  }

  get(...params: unknown[]): unknown {
    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    const stmt = this.db.prepare(this.sql);
    stmt.bind(flatParams as (string | number | null | Uint8Array)[]);
    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      const row: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        row[columns[i]] = values[i];
      }
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  all(...params: unknown[]): unknown[] {
    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    const stmt = this.db.prepare(this.sql);
    stmt.bind(flatParams as (string | number | null | Uint8Array)[]);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      const row: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        row[columns[i]] = values[i];
      }
      rows.push(row);
    }
    stmt.free();
    return rows;
  }
}

export class MockDatabase {
  private db: SqlJsDatabase;

  constructor(_path: string) {
    if (!SQL) {
      throw new Error('Call initMock() before creating MockDatabase instances');
    }
    this.db = new SQL.Database();
  }

  pragma(pragma: string): unknown {
    try {
      const stmt = this.db.prepare(`PRAGMA ${pragma}`);
      if (stmt.step()) {
        const val = stmt.get()[0];
        stmt.free();
        return [{ [pragma.split('=')[0].trim()]: val }];
      }
      stmt.free();
      return [];
    } catch {
      return [];
    }
  }

  exec(sql: string): void {
    this.db.run(sql);
  }

  prepare(sql: string): MockStatement {
    return new MockStatement(this.db, sql);
  }

  close(): void {
    this.db.close();
  }
}
