/**
 * knowledge/store — Base de conhecimento HÍBRIDA (mandato FASE 1):
 *
 *   - **Markdown no disco** (`.clover/knowledge/<id>.md`) = fonte da verdade,
 *     legível/editável por humanos (frontmatter próprio, ver markdown.ts);
 *   - **SQLite** (`.clover/knowledge.db`, sql.js/WASM) = índice estruturado
 *     para consulta (tags, links, busca) — reconstruível a partir dos .md.
 *
 * `reconcile()` ressincroniza SQLite ⇄ disco: arquivos .md novos/alterados
 * entram no índice, linhas órfãs (arquivo apagado) saem, links pendurados são
 * removidos. É a implementação real de `compact_memory`.
 *
 * Determinismo: consultas com ORDER BY; timestamps vêm do relógio na CRIAÇÃO
 * (metadado), nunca afetam resultados de consulta.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Database } from 'sql.js';

import { loadSql } from '../shared/sqljs.js';
import { parseMemory, serializeMemory, slugify, type MemoryDocument } from './markdown.js';

export const KNOWLEDGE_DIR_REL = '.clover/knowledge';
export const KNOWLEDGE_DB_REL = '.clover/knowledge.db';

const SCHEMA_VERSION = 1;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_tags (
  id  TEXT NOT NULL,
  tag TEXT NOT NULL,
  UNIQUE(id, tag)
);
CREATE TABLE IF NOT EXISTS memory_links (
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  UNIQUE(from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON memory_tags(tag);
`;

export interface MemorySummary {
  id: string;
  title: string;
  tags: string[];
  links: string[];
  updatedAt: number;
}

export interface KnowledgeStats {
  memories: number;
  tags: Array<{ tag: string; count: number }>;
  links: number;
  totalContentBytes: number;
}

export interface ReconcileResult {
  indexed: number;
  removed: number;
  danglingLinksPruned: number;
}

export class KnowledgeStore {
  private constructor(
    private readonly db: Database,
    private readonly dbPath: string,
    private readonly mdDir: string,
  ) {}

  /** Abre a base (SQLite + diretório de .md), aplicando o schema. */
  static async open(dbPath: string, mdDir: string): Promise<KnowledgeStore> {
    const SQL = await loadSql();
    let db: Database;
    if (dbPath !== ':memory:' && existsSync(dbPath)) {
      db = new SQL.Database(readFileSync(dbPath));
    } else {
      db = new SQL.Database();
    }
    const ver = Number(db.exec('PRAGMA user_version')[0]?.values[0]?.[0] ?? 0);
    if (ver !== SCHEMA_VERSION) {
      db.run('DROP TABLE IF EXISTS memories; DROP TABLE IF EXISTS memory_tags; DROP TABLE IF EXISTS memory_links;');
      db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    db.run(SCHEMA);
    mkdirSync(mdDir, { recursive: true });
    return new KnowledgeStore(db, dbPath, mdDir);
  }

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

  private mdPath(id: string): string {
    return join(this.mdDir, `${id}.md`);
  }

  /** Grava .md (verdade) + linhas no índice. Retorna o documento gravado. */
  private writeBoth(doc: MemoryDocument): MemoryDocument {
    writeFileSync(this.mdPath(doc.id), serializeMemory(doc), 'utf8');
    this.db.run('INSERT OR REPLACE INTO memories (id, title, content, created_at, updated_at) VALUES (?,?,?,?,?)', [
      doc.id, doc.title, doc.content, doc.createdAt, doc.updatedAt,
    ]);
    this.db.run('DELETE FROM memory_tags WHERE id = ?', [doc.id]);
    for (const tag of doc.tags) this.db.run('INSERT OR IGNORE INTO memory_tags (id, tag) VALUES (?,?)', [doc.id, tag]);
    this.db.run('DELETE FROM memory_links WHERE from_id = ?', [doc.id]);
    for (const to of doc.links) this.db.run('INSERT OR IGNORE INTO memory_links (from_id, to_id) VALUES (?,?)', [doc.id, to]);
    return doc;
  }

  /** Cria memória nova; id = slug do título (colisão → sufixo -2, -3, ...). */
  save(title: string, content: string, tags: string[], now: number): MemoryDocument {
    const base = slugify(title);
    let id = base;
    for (let n = 2; this.get(id) !== null; n++) id = `${base}-${n}`;
    return this.writeBoth({ id, title, tags, links: [], createdAt: now, updatedAt: now, content });
  }

  /** Atualiza campos de uma memória existente; `null` se não existir. */
  update(
    id: string,
    patch: { title?: string; content?: string; tags?: string[]; links?: string[] },
    now: number,
  ): MemoryDocument | null {
    const cur = this.get(id);
    if (!cur) return null;
    return this.writeBoth({
      ...cur,
      title: patch.title ?? cur.title,
      content: patch.content ?? cur.content,
      tags: patch.tags ?? cur.tags,
      links: patch.links ?? cur.links,
      updatedAt: now,
    });
  }

  /** Remove memória (md + índice) e poda os links reversos NOS .md dos linkers. */
  delete(id: string): boolean {
    if (this.get(id) === null) return false;
    // Linkers primeiro: rewrite do .md sem o link (md e índice ficam coerentes).
    const linkers = this.queryAll('SELECT DISTINCT from_id FROM memory_links WHERE to_id = ? ORDER BY from_id', [id]);
    for (const r of linkers) {
      const doc = this.get(String(r.from_id));
      if (doc) this.writeBoth({ ...doc, links: doc.links.filter((l) => l !== id) });
    }
    rmSync(this.mdPath(id), { force: true });
    this.db.run('DELETE FROM memories WHERE id = ?', [id]);
    this.db.run('DELETE FROM memory_tags WHERE id = ?', [id]);
    this.db.run('DELETE FROM memory_links WHERE from_id = ? OR to_id = ?', [id, id]);
    return true;
  }

  /** Memória completa por id (do índice), ou `null`. */
  get(id: string): MemoryDocument | null {
    const r = this.queryAll('SELECT id, title, content, created_at, updated_at FROM memories WHERE id = ?', [id])[0];
    if (!r) return null;
    return {
      id: String(r.id),
      title: String(r.title),
      content: String(r.content),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      tags: this.queryAll('SELECT tag FROM memory_tags WHERE id = ? ORDER BY tag', [id]).map((x) => String(x.tag)),
      links: this.queryAll('SELECT to_id FROM memory_links WHERE from_id = ? ORDER BY to_id', [id]).map((x) => String(x.to_id)),
    };
  }

  /** Lista resumos (filtro opcional por tag). Determinístico. */
  list(tag?: string): MemorySummary[] {
    const rows = tag
      ? this.queryAll(
          'SELECT m.id FROM memories m JOIN memory_tags t ON t.id = m.id WHERE t.tag = ? ORDER BY m.id',
          [tag],
        )
      : this.queryAll('SELECT id FROM memories ORDER BY id');
    return rows.map((r) => {
      const d = this.get(String(r.id)) as MemoryDocument;
      return { id: d.id, title: d.title, tags: d.tags, links: d.links, updatedAt: d.updatedAt };
    });
  }

  /** Corpus completo (id + texto título+conteúdo) para o ranqueador. */
  corpus(): Array<{ id: string; text: string }> {
    return this.queryAll('SELECT id, title, content FROM memories ORDER BY id').map((r) => ({
      id: String(r.id),
      text: `${String(r.title)}\n${String(r.content)}`,
    }));
  }

  /** Busca estruturada: LIKE em título/conteúdo e/ou filtro por tag. */
  query(text?: string, tag?: string): MemorySummary[] {
    let ids: string[];
    if (text) {
      const like = `%${text}%`;
      ids = this.queryAll(
        'SELECT id FROM memories WHERE title LIKE ? OR content LIKE ? ORDER BY id',
        [like, like],
      ).map((r) => String(r.id));
    } else {
      ids = this.queryAll('SELECT id FROM memories ORDER BY id').map((r) => String(r.id));
    }
    let out = ids.map((id) => this.get(id) as MemoryDocument);
    if (tag) out = out.filter((d) => d.tags.includes(tag));
    return out.map((d) => ({ id: d.id, title: d.title, tags: d.tags, links: d.links, updatedAt: d.updatedAt }));
  }

  stats(): KnowledgeStats {
    const memories = Number(this.queryAll('SELECT COUNT(*) AS n FROM memories')[0]?.n ?? 0);
    const links = Number(this.queryAll('SELECT COUNT(*) AS n FROM memory_links')[0]?.n ?? 0);
    const totalContentBytes = Number(
      this.queryAll('SELECT COALESCE(SUM(LENGTH(content)),0) AS n FROM memories')[0]?.n ?? 0,
    );
    const tags = this.queryAll(
      'SELECT tag, COUNT(*) AS count FROM memory_tags GROUP BY tag ORDER BY count DESC, tag',
    ).map((r) => ({ tag: String(r.tag), count: Number(r.count) }));
    return { memories, tags, links, totalContentBytes };
  }

  /**
   * Reconciliação SQLite ⇄ disco (implementação real de `compact_memory`):
   * .md novos/alterados → indexados; linhas sem .md → removidas; links para
   * memórias inexistentes → podados (dos .md e do índice).
   */
  reconcile(): ReconcileResult {
    let indexed = 0;
    let removed = 0;
    let danglingLinksPruned = 0;

    // 1) Disco → índice.
    const diskIds = new Set<string>();
    for (const entry of readdirSync(this.mdDir).sort()) {
      if (!entry.endsWith('.md')) continue;
      const parsed = parseMemory(readFileSync(join(this.mdDir, entry), 'utf8'));
      if (!parsed) continue; // formato inválido: ignorado (não é memória nossa)
      diskIds.add(parsed.id);
      const cur = this.get(parsed.id);
      if (!cur || cur.updatedAt !== parsed.updatedAt || cur.content !== parsed.content) {
        this.writeBoth(parsed);
        indexed++;
      }
    }

    // 2) Índice → disco (órfãos saem). Só os links DE SAÍDA do órfão morrem aqui;
    //    os de ENTRADA ficam pendurados de propósito — o passo 3 os poda também
    //    dos .md dos linkers (senão o índice esqueceria e o .md mentiria).
    for (const r of this.queryAll('SELECT id FROM memories ORDER BY id')) {
      const id = String(r.id);
      if (!diskIds.has(id)) {
        this.db.run('DELETE FROM memories WHERE id = ?', [id]);
        this.db.run('DELETE FROM memory_tags WHERE id = ?', [id]);
        this.db.run('DELETE FROM memory_links WHERE from_id = ?', [id]);
        removed++;
      }
    }

    // 3) Links pendurados (alvo não existe) — poda no índice e nos .md.
    for (const r of this.queryAll(
      'SELECT DISTINCT from_id FROM memory_links WHERE to_id NOT IN (SELECT id FROM memories) ORDER BY from_id',
    )) {
      const fromId = String(r.from_id);
      const doc = this.get(fromId);
      if (!doc) continue;
      const valid = doc.links.filter((l) => this.get(l) !== null);
      danglingLinksPruned += doc.links.length - valid.length;
      this.writeBoth({ ...doc, links: valid });
    }

    return { indexed, removed, danglingLinksPruned };
  }

  /** Persiste o índice SQLite em disco (no-op para `:memory:`). */
  persist(): void {
    if (this.dbPath === ':memory:') return;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }

  close(): void {
    this.db.close();
  }
}
