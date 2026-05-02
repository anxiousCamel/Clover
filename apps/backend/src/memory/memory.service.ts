import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Chunk, VectorChunk, MemorySearchOptions } from '@clover/shared';
import { config } from '../config/config.js';
import { split } from './chunker.js';
import { embed } from './embedder.js';
import * as lancedb from './lancedb.adapter.js';
import * as obsidian from './obsidian.adapter.js';
import type { WriteMode } from './obsidian.adapter.js';

/**
 * Search memory by embedding the query and running similarity search.
 */
export async function search(
  query: string,
  topK?: number,
  filter?: string,
): Promise<Chunk[]> {
  const vector = await embed(query);
  const k = topK ?? config.memory.topK;
  return lancedb.similaritySearch(vector, k, filter);
}

/**
 * Index arbitrary text into LanceDB.
 * Splits into chunks, embeds each, and batch-inserts.
 */
export async function indexText(
  text: string,
  metadata?: { source?: string },
): Promise<void> {
  const chunks = split(text, metadata);
  if (chunks.length === 0) return;

  const vectorChunks = await toVectorChunks(chunks);
  await lancedb.insert(vectorChunks);
}

/**
 * Index a single vault file by path.
 * Reads via obsidian adapter, chunks, embeds, and upserts by path.
 */
export async function indexFile(filePath: string): Promise<void> {
  const content = await obsidian.read(filePath);
  const chunks = split(content, { source: filePath });
  if (chunks.length === 0) return;

  const vectorChunks = await toVectorChunks(chunks, filePath);
  await lancedb.upsertByPath(filePath, vectorChunks);
}

/**
 * Index all markdown files in a directory.
 * Reads directory, filters for .md files, and indexes each.
 */
export async function ingestDirectory(dirPath: string): Promise<void> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(dirPath, e.name));

  for (const file of mdFiles) {
    await indexFile(file);
  }
}

/**
 * Write a note to the Obsidian vault — delegates directly to obsidian adapter.
 */
export async function writeNote(
  filePath: string,
  content: string,
  mode: WriteMode,
  confirmFn?: () => Promise<boolean>,
): Promise<void> {
  await obsidian.writeNote(filePath, content, mode, confirmFn);
}

// ── helpers ──────────────────────────────────────────────

/**
 * Convert plain Chunks to VectorChunks by embedding each chunk's text.
 */
async function toVectorChunks(
  chunks: Chunk[],
  filePath?: string,
): Promise<VectorChunk[]> {
  const now = new Date().toISOString();
  const results: VectorChunk[] = [];

  for (const chunk of chunks) {
    const vector = await embed(chunk.text);
    results.push({
      ...chunk,
      filePath: filePath ?? chunk.filePath,
      vector: new Float32Array(vector),
      timestamp: now,
    });
  }

  return results;
}
