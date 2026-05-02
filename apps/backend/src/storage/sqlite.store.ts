/**
 * SQLiteStore — session and message persistence backed by sql.js (pure JS/Wasm).
 *
 * Replaces better-sqlite3 to avoid native C++ compilation on Windows.
 * sql.js runs SQLite compiled to WebAssembly — zero native deps.
 *
 * NOTE: sql.js is in-memory by default. We persist to disk manually via
 * `exportDatabase()` on writes and load from file on construction.
 *
 * @module storage/sqlite.store
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Message } from '@clover/shared';

export interface Session {
  id: string;
  workspace: string;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolExecution {
  id: number;
  session_id: string;
  tool_name: string;
  args: string;
  result: string | null;
  success: number;
  duration_ms: number | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert sql.js row arrays into objects keyed by column name. */
function rowToObject(columns: string[], values: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    obj[columns[i]] = values[i];
  }
  return obj;
}

// ---------------------------------------------------------------------------
// SQLiteStore
// ---------------------------------------------------------------------------

export class SQLiteStore {
  private db!: SqlJsDatabase;
  private dbPath: string;
  private ready: Promise<void>;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.ready = this.init();
  }

  /** Ensure the store is ready before any operation. */
  async ensureReady(): Promise<void> {
    await this.ready;
  }

  private async init(): Promise<void> {
    const SQL = await initSqlJs();

    // Load existing DB file if present
    if (this.dbPath !== ':memory:' && existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA foreign_keys = ON');
    this.createSchema();
  }

  private persist(): void {
    if (this.dbPath === ':memory:') return;
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  private createSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id          TEXT PRIMARY KEY,
        workspace   TEXT NOT NULL,
        model       TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role         TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
        content      TEXT NOT NULL,
        tool_name    TEXT,
        tool_call_id TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tool_executions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        tool_name   TEXT NOT NULL,
        args        TEXT NOT NULL,
        result      TEXT,
        success     INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id           TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        goal         TEXT NOT NULL,
        status       TEXT NOT NULL CHECK(status IN ('running','blocked','done','failed')),
        current_step TEXT,
        steps        TEXT NOT NULL, -- JSON array of TaskStep
        attempts     INTEGER NOT NULL DEFAULT 0,
        budget       TEXT NOT NULL, -- JSON object of ExecutionBudget
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // ── Session CRUD ──────────────────────────────────────────────────────

  createSession(workspacePath: string): Session {
    const id = uuidv4();
    this.db.run('INSERT INTO sessions (id, workspace) VALUES (?, ?)', [id, workspacePath]);
    this.persist();
    return this.getSession(id)!;
  }

  getSession(id: string): Session | undefined {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      stmt.free();
      return rowToObject(columns, values) as unknown as Session;
    }
    stmt.free();
    return undefined;
  }

  deleteSession(id: string): void {
    // Manual cascade since sql.js foreign key cascade can be unreliable
    this.db.run('DELETE FROM messages WHERE session_id = ?', [id]);
    this.db.run('DELETE FROM tool_executions WHERE session_id = ?', [id]);
    this.db.run('DELETE FROM sessions WHERE id = ?', [id]);
    this.persist();
  }

  updateModel(sessionId: string, model: string): void {
    this.db.run(
      "UPDATE sessions SET model = ?, updated_at = datetime('now') WHERE id = ?",
      [model, sessionId],
    );
    this.persist();
  }

  // ── Messages ──────────────────────────────────────────────────────────

  saveMessage(sessionId: string, message: Message): void {
    this.db.run(
      `INSERT INTO messages (session_id, role, content, tool_name, tool_call_id)
       VALUES (?, ?, ?, ?, ?)`,
      [
        sessionId,
        message.role,
        message.content,
        message.tool_name ?? null,
        message.tool_call_id ?? null,
      ],
    );
    this.db.run(
      "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?",
      [sessionId],
    );
    this.persist();
  }

  getHistory(sessionId: string, limit = 20): Message[] {
    const stmt = this.db.prepare(`
      SELECT role, content, tool_name, tool_call_id, created_at
      FROM messages
      WHERE session_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `);
    stmt.bind([sessionId, limit]);

    const rows: Message[] = [];
    while (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      rows.push(rowToObject(columns, values) as unknown as Message);
    }
    stmt.free();
    return rows;
  }

  // ── Tool executions ───────────────────────────────────────────────────

  logToolExecution(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    result: unknown,
    success: boolean,
    durationMs: number,
  ): void {
    this.db.run(
      `INSERT INTO tool_executions (session_id, tool_name, args, result, success, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        toolName,
        JSON.stringify(args),
        JSON.stringify(result),
        success ? 1 : 0,
        durationMs,
      ],
    );
    this.persist();
  }

  // ── Tasks ────────────────────────────────────────────────────────────

  saveTask(sessionId: string, task: import('@clover/shared').TaskState): void {
    this.db.run(
      `INSERT OR REPLACE INTO tasks (id, session_id, goal, status, current_step, steps, attempts, budget)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        sessionId,
        task.goal,
        task.status,
        task.currentStep ?? null,
        JSON.stringify(task.steps),
        task.attempts,
        JSON.stringify(task.budget),
      ],
    );
    this.persist();
  }

  getTask(id: string): any | undefined {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      const raw = rowToObject(columns, values);
      stmt.free();
      return {
        ...raw,
        steps: JSON.parse(raw.steps as string),
        budget: JSON.parse(raw.budget as string),
      };
    }
    stmt.free();
    return undefined;
  }

  getTaskBySession(sessionId: string): any | undefined {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC LIMIT 1');
    stmt.bind([sessionId]);
    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      const raw = rowToObject(columns, values);
      stmt.free();
      return {
        ...raw,
        steps: JSON.parse(raw.steps as string),
        budget: JSON.parse(raw.budget as string),
      };
    }
    stmt.free();
    return undefined;
  }

  close(): void {
    this.db.close();
  }
}
