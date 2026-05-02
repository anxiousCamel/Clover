/**
 * Search-Online Tool Plugin — performs web search with automatic offline fallback.
 *
 * Delegates to the search service which transparently selects the best available
 * adapter (DuckDuckGo when online, LanceDB semantic search when offline).
 * Never requires user confirmation (read-only operation).
 */

import { z } from 'zod';
import type { ToolPlugin, ToolContext, ToolResult, SearchResult } from '@clover/shared';
import { search } from '../../search/search.service.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  query: z.string().min(1, 'query is required'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an array of SearchResult into a human-readable string.
 * Each result shows title, url (if available), and snippet.
 */
function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  return results
    .map((r, i) => {
      const parts = [`${i + 1}. ${r.title}`];
      if (r.url) {
        parts.push(`   URL: ${r.url}`);
      }
      parts.push(`   ${r.snippet}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: ToolPlugin = {
  name: 'search-online',
  description:
    'Search the web for current information. Automatically falls back to local semantic search when offline.',
  inputSchema,

  requiresConfirmation: () => false,

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const { query } = inputSchema.parse(args);

    try {
      const results = await search(query);
      const output = formatResults(results);
      return { success: true, output };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown search error';
      return { success: false, output: '', error: message };
    }
  },
};

export default plugin;
