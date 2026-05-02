/**
 * Offline search adapter — performs semantic similarity search
 * against the local LanceDB knowledge index when the machine is offline.
 */

import type { SearchAdapter, SearchOptions, SearchResult } from '@clover/shared';
import { embed } from '../memory/embedder.js';
import { similaritySearch } from '../memory/lancedb.adapter.js';

export const offlineAdapter: SearchAdapter = {
  name: 'offline',

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const maxResults = options.maxResults ?? 5;
    const filter = options.source ? `source = '${options.source}'` : undefined;

    const vector = await embed(query);
    const chunks = await similaritySearch(vector, maxResults, filter);

    return chunks.map((chunk) => ({
      title: chunk.filePath ?? chunk.source,
      url: chunk.filePath,
      snippet: chunk.text,
      source: 'offline',
    }));
  },
};
