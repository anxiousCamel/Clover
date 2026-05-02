/**
 * DuckDuckGo search adapter — performs web searches via the
 * DuckDuckGo HTML endpoint and parses results with simple regex.
 */

import type { SearchAdapter, SearchOptions, SearchResult } from '@clover/shared';
import { isOnline } from './connectivity.check.js';

const DDG_URL = 'https://html.duckduckgo.com/html/?q=';

/**
 * Extract result blocks from the DuckDuckGo HTML response.
 * Each result lives inside a div.result; we pull the link title, href, and snippet.
 */
function parseResults(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Match each result block — DuckDuckGo wraps them in <div class="result ...">
  const blockRe = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*result|$)/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRe.exec(html)) !== null && results.length < max) {
    const block = blockMatch[1];

    // Title + URL from the result link
    const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
    const linkMatch = linkRe.exec(block);
    if (!linkMatch) continue;

    const url = linkMatch[1];
    const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();

    // Snippet from the result snippet element
    const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
    const snippetMatch = snippetRe.exec(block);
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]+>/g, '').trim()
      : '';

    if (title) {
      results.push({ title, url, snippet, source: 'duckduckgo' });
    }
  }

  return results;
}

export const duckduckgoAdapter: SearchAdapter = {
  name: 'duckduckgo',

  async isAvailable(): Promise<boolean> {
    return isOnline();
  },

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const maxResults = options.maxResults ?? 5;
    const url = DDG_URL + encodeURIComponent(query);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Clover/1.0',
      },
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    return parseResults(html, maxResults);
  },
};
