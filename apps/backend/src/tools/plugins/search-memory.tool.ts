/**
 * Search-Memory Tool Plugin — performs semantic search over the RAG memory store.
 *
 * Delegates to the memory service which embeds the query and runs similarity
 * search in LanceDB. Returns matching chunks with source, text, and score.
 * Never requires user confirmation (read-only operation).
 */

import { z } from 'zod';
import type { ToolPlugin, ToolContext, ToolResult, Chunk } from '@clover/shared';
import { search } from '../../memory/memory.service.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  query: z.string().min(1, 'query is required'),
  topK: z.number().int().positive().optional().default(5),
  filter: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an array of Chunk into a human-readable string.
 * Each chunk shows source, text, and score (when available).
 */
function formatChunks(chunks: Chunk[]): string {
  if (chunks.length === 0) {
    return 'No memory chunks found.';
  }

  return chunks
    .map((chunk, i) => {
      const parts = [`${i + 1}. [${chunk.source}]`];
      if (chunk.score !== undefined) {
        parts[0] += ` (score: ${chunk.score.toFixed(4)})`;
      }
      parts.push(`   ${chunk.text}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: 'search-memory',
  description:
    'Search the local RAG memory store for relevant context from past conversations, vault notes, and ingested documents.',
  inputSchema,

  requiresConfirmation: () => false,

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const { query, topK, filter } = inputSchema.parse(args);

    try {
      const chunks = await search(query, topK, filter);
      const output = formatChunks(chunks);
      return { success: true, output };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown memory search error';
      return { success: false, output: '', error: message };
    }
  },
};

export default plugin;
