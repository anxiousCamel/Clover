/**
 * Memory / vector-store interfaces for Clover's RAG pipeline.
 */

/** A text chunk retrieved from or stored in the memory system. */
export interface Chunk {
  id: string;
  source: string;
  filePath?: string;
  sessionId?: string;
  text: string;
  score?: number;
}

/** A chunk with its embedding vector, ready for LanceDB storage. */
export interface VectorChunk extends Chunk {
  vector: Float32Array;
  timestamp: string;
  metadata?: Record<string, string>;
}

/** Options for a memory similarity search. */
export interface MemorySearchOptions {
  topK?: number;
  source?: string;
  filePath?: string;
}
