/**
 * Search service — unified search interface that auto-selects the
 * highest-priority available adapter (DuckDuckGo → Offline fallback).
 */

import type { SearchAdapter, SearchOptions, SearchResult } from '@clover/shared';
import { duckduckgoAdapter } from './duckduckgo.adapter.js';
import { offlineAdapter } from './offline.adapter.js';

/** Ordered priority list — first available adapter wins. */
const adapters: SearchAdapter[] = [duckduckgoAdapter, offlineAdapter];

/**
 * Register a new search adapter. It is appended to the priority list.
 */
export function registerAdapter(adapter: SearchAdapter): void {
  adapters.push(adapter);
}

/**
 * Search using the first available adapter in priority order.
 * Checks isAvailable() on each adapter and delegates to the first one that returns true.
 */
export async function search(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  for (const adapter of adapters) {
    if (await adapter.isAvailable()) {
      return adapter.search(query, options);
    }
  }

  // Should never happen — offline adapter always returns true
  return [];
}
