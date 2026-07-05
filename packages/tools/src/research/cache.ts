/**
 * research/cache — Cache de documentação em disco (SRP: só persistência).
 *
 * Cada URL vira um arquivo JSON em `.clover/research-cache/<sha256[:24]>.json`
 * com corpo + metadados. Torna a pesquisa reprodutível/offline: uma vez
 * buscado (ou semeado via `cache_documentation`), o conteúdo fica disponível
 * para `search_documentation`/`summarize_documentation` sem rede.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const RESEARCH_CACHE_REL = '.clover/research-cache';

export interface CacheEntry {
  url: string;
  contentType: string | null;
  fetchedAt: number;
  body: string;
}

export function cacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 24);
}

export class DocCache {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  get(url: string): CacheEntry | null {
    try {
      const raw = readFileSync(join(this.dir, `${cacheKey(url)}.json`), 'utf8');
      const parsed = JSON.parse(raw) as CacheEntry;
      return typeof parsed.url === 'string' && typeof parsed.body === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  put(entry: CacheEntry): string {
    const key = cacheKey(entry.url);
    writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(entry), 'utf8');
    return key;
  }

  /** Todas as entradas (ordenadas por URL — determinístico). */
  all(): CacheEntry[] {
    let files: string[];
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    const out: CacheEntry[] = [];
    for (const f of files) {
      try {
        const parsed = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as CacheEntry;
        if (typeof parsed.url === 'string' && typeof parsed.body === 'string') out.push(parsed);
      } catch {
        continue;
      }
    }
    return out.sort((a, b) => a.url.localeCompare(b.url));
  }
}
