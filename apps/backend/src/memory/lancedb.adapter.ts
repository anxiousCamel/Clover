import * as lancedb from 'vectordb';
import type { Chunk, VectorChunk } from '@clover/shared';

let db: lancedb.Connection;
let table: lancedb.Table;

const TABLE_NAME = 'chunks';

/**
 * Initialize embedded LanceDB instance at the given path.
 * Opens existing table or creates one with an empty first record schema.
 */
export async function init(dbPath: string): Promise<void> {
  db = await lancedb.connect(dbPath);
  try {
    table = await db.openTable(TABLE_NAME);
  } catch {
    // Table doesn't exist yet — create with empty seed row then delete it
    const seed = [
      {
        id: '__seed__',
        source: '',
        filePath: '',
        sessionId: '',
        text: '',
        vector: Array.from({ length: 1 }, () => 0),
        timestamp: '',
        metadata: '',
      },
    ];
    table = await db.createTable(TABLE_NAME, seed);
    await table.delete(`id = '__seed__'`);
  }
}

/**
 * Batch insert VectorChunks into LanceDB.
 * Converts Float32Array vectors to plain number arrays.
 */
export async function insert(chunks: VectorChunk[]): Promise<void> {
  if (chunks.length === 0) return;

  const rows = chunks.map(toRow);
  await table.add(rows);
}

/**
 * Upsert chunks for a given file path — removes old chunks for that path
 * first, then inserts the new ones.
 */
export async function upsertByPath(
  path: string,
  chunks: VectorChunk[],
): Promise<void> {
  // Remove existing chunks for this file path
  await table.delete(`filePath = '${path}'`);

  if (chunks.length > 0) {
    await insert(chunks);
  }
}

/**
 * Perform similarity search against the stored vectors.
 * Returns Chunk[] (no vector field) sorted by score descending.
 */
export async function similaritySearch(
  vector: number[],
  topK: number,
  filter?: string,
): Promise<Chunk[]> {
  let query = table.search(vector).limit(topK);

  if (filter) {
    query = query.where(filter);
  }

  const results = await query.execute();

  return results.map((row: Record<string, unknown>) => ({
    id: row['id'] as string,
    source: row['source'] as string,
    filePath: (row['filePath'] as string) || undefined,
    sessionId: (row['sessionId'] as string) || undefined,
    text: row['text'] as string,
    score: typeof row['_distance'] === 'number' ? 1 / (1 + row['_distance']) : undefined,
  }));
}

/** Convert a VectorChunk to a plain-object row for LanceDB storage. */
function toRow(chunk: VectorChunk): Record<string, unknown> {
  return {
    id: chunk.id,
    source: chunk.source,
    filePath: chunk.filePath ?? '',
    sessionId: chunk.sessionId ?? '',
    text: chunk.text,
    vector: Array.from(chunk.vector),
    timestamp: chunk.timestamp,
    metadata: chunk.metadata ? JSON.stringify(chunk.metadata) : '',
  };
}
