/**
 * Search adapter interfaces for Clover's pluggable search system.
 */

/** Options passed to a search adapter. */
export interface SearchOptions {
  maxResults?: number;
  source?: string;
}

/** A single search result. */
export interface SearchResult {
  title: string;
  url?: string;
  snippet: string;
  source: string;
}

/** Contract that every search provider must implement. */
export interface SearchAdapter {
  name: string;
  isAvailable(): Promise<boolean>;
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}
