/**
 * Unit tests for Search Service fallback behavior.
 *
 * Validates: Requirements 15.1, 15.2, 16.1
 *
 * Tests that the Search Service:
 * - Uses the online adapter when it is available (15.2, 16.1)
 * - Falls back to the offline adapter when DuckDuckGo is unavailable (15.1, 15.2)
 * - Supports registering new adapters (16.1)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchAdapter, SearchResult } from '@clover/shared';

// ── Mock the real adapters before importing the service ──────────────

const mockDuckDuckGoResults: SearchResult[] = [
  { title: 'DDG Result', url: 'https://example.com', snippet: 'Online result', source: 'duckduckgo' },
];

const mockOfflineResults: SearchResult[] = [
  { title: 'Offline Result', snippet: 'Local semantic match', source: 'offline' },
];

let duckDuckGoAvailable = true;

vi.mock('../duckduckgo.adapter.js', () => ({
  duckduckgoAdapter: {
    name: 'duckduckgo',
    isAvailable: vi.fn(async () => duckDuckGoAvailable),
    search: vi.fn(async () => mockDuckDuckGoResults),
  } satisfies SearchAdapter,
}));

vi.mock('../offline.adapter.js', () => ({
  offlineAdapter: {
    name: 'offline',
    isAvailable: vi.fn(async () => true),
    search: vi.fn(async () => mockOfflineResults),
  } satisfies SearchAdapter,
}));

const { search, registerAdapter } = await import('../search.service.js');
const { duckduckgoAdapter } = await import('../duckduckgo.adapter.js');
const { offlineAdapter } = await import('../offline.adapter.js');

describe('Search Service', () => {
  beforeEach(() => {
    duckDuckGoAvailable = true;
    // Reset call counts but preserve the mock factory implementations
    vi.mocked(duckduckgoAdapter.isAvailable).mockReset().mockImplementation(async () => duckDuckGoAvailable);
    vi.mocked(duckduckgoAdapter.search).mockReset().mockImplementation(async () => mockDuckDuckGoResults);
    vi.mocked(offlineAdapter.isAvailable).mockReset().mockImplementation(async () => true);
    vi.mocked(offlineAdapter.search).mockReset().mockImplementation(async () => mockOfflineResults);
  });

  // ── Online adapter used when available ─────────────────────────────

  describe('online adapter used when available', () => {
    it('should use DuckDuckGo adapter when it reports available', async () => {
      duckDuckGoAvailable = true;

      const results = await search('test query');

      expect(duckduckgoAdapter.isAvailable).toHaveBeenCalled();
      expect(duckduckgoAdapter.search).toHaveBeenCalledWith('test query', {});
      expect(results).toEqual(mockDuckDuckGoResults);
    });

    it('should not call offline adapter when DuckDuckGo is available', async () => {
      duckDuckGoAvailable = true;

      await search('test query');

      expect(offlineAdapter.search).not.toHaveBeenCalled();
    });

    it('should pass search options through to the selected adapter', async () => {
      duckDuckGoAvailable = true;
      const options = { maxResults: 3, source: 'web' };

      await search('query with options', options);

      expect(duckduckgoAdapter.search).toHaveBeenCalledWith('query with options', options);
    });
  });

  // ── Automatic fallback to offline adapter ──────────────────────────

  describe('automatic fallback to offline adapter when DuckDuckGo unavailable', () => {
    it('should fall back to offline adapter when DuckDuckGo is unavailable', async () => {
      duckDuckGoAvailable = false;

      const results = await search('offline query');

      expect(duckduckgoAdapter.isAvailable).toHaveBeenCalled();
      expect(duckduckgoAdapter.search).not.toHaveBeenCalled();
      expect(offlineAdapter.isAvailable).toHaveBeenCalled();
      expect(offlineAdapter.search).toHaveBeenCalledWith('offline query', {});
      expect(results).toEqual(mockOfflineResults);
    });

    it('should check adapters in priority order (DuckDuckGo first, then Offline)', async () => {
      duckDuckGoAvailable = false;
      const callOrder: string[] = [];

      vi.mocked(duckduckgoAdapter.isAvailable).mockImplementation(async () => {
        callOrder.push('duckduckgo.isAvailable');
        return false;
      });
      vi.mocked(offlineAdapter.isAvailable).mockImplementation(async () => {
        callOrder.push('offline.isAvailable');
        return true;
      });

      await search('priority test');

      expect(callOrder).toEqual(['duckduckgo.isAvailable', 'offline.isAvailable']);
    });
  });

  // ── Adapter registration ───────────────────────────────────────────

  describe('adapter registration', () => {
    it('should include a registered adapter in the selection process', async () => {
      duckDuckGoAvailable = false;

      const customResults: SearchResult[] = [
        { title: 'Custom', snippet: 'Custom result', source: 'custom' },
      ];

      const customAdapter: SearchAdapter = {
        name: 'custom',
        isAvailable: vi.fn(async () => true),
        search: vi.fn(async () => customResults),
      };

      // Make offline adapter unavailable so the newly registered adapter is reached
      vi.mocked(offlineAdapter.isAvailable).mockResolvedValue(false);

      registerAdapter(customAdapter);

      const results = await search('custom query');

      expect(customAdapter.isAvailable).toHaveBeenCalled();
      expect(customAdapter.search).toHaveBeenCalledWith('custom query', {});
      expect(results).toEqual(customResults);
    });

    it('should prefer higher-priority adapters over registered ones', async () => {
      // DuckDuckGo is available, so it should be used even though
      // custom adapters were registered in previous tests
      duckDuckGoAvailable = true;

      const results = await search('test');

      expect(duckduckgoAdapter.search).toHaveBeenCalledWith('test', {});
      expect(results).toEqual(mockDuckDuckGoResults);
    });
  });
});
