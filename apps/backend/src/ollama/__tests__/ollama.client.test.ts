/**
 * Unit tests for Ollama Client retry logic.
 *
 * Validates: Requirements 27.4
 *
 * Tests that the Ollama client retries failed requests up to 3 times
 * with exponential backoff, and throws typed OllamaError on permanent failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the config module before importing the client
vi.mock('../../config/config.js', () => ({
  config: {
    ollama: {
      host: 'http://localhost:11434',
      retryAttempts: 3,
      retryBackoffMs: 1000,
    },
  },
}));

// Import after mocks are set up
const { chat, embed, listModels, OllamaError } = await import('../ollama.client.js');

describe('Ollama Client retry logic', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function okResponse(body: unknown): Response {
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
  }

  function serverErrorResponse(status = 500): Response {
    return {
      ok: false,
      status,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('Internal Server Error'),
    } as unknown as Response;
  }

  /**
   * Helper: run a promise to completion with fake timers, catching any
   * rejection so it doesn't surface as an unhandled rejection warning.
   * Returns the settled result.
   */
  async function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    // Attach a no-op catch immediately to prevent unhandled rejection
    const guarded = promise.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );

    // Drain all pending timers (retry backoff sleeps)
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(2000);
    }

    return guarded;
  }

  // ── Retry on transient network errors ──────────────────────────────

  describe('retry on transient network errors', () => {
    it('should retry on network error and succeed on second attempt', async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(okResponse({ models: [{ name: 'llama3' }] }));

      const result = await settle(listModels());

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual([{ name: 'llama3' }]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should retry on network error and succeed on third attempt', async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce(okResponse({ message: { content: 'hello' } }));

      const result = await settle(chat([{ role: 'user', content: 'hi' }], 'llama3'));

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe('hello');
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  // ── Retry on 5xx server errors ─────────────────────────────────────

  describe('retry on 5xx server errors', () => {
    it('should retry on HTTP 500 and succeed on second attempt', async () => {
      fetchSpy
        .mockResolvedValueOnce(serverErrorResponse(500))
        .mockResolvedValueOnce(okResponse({ embedding: [0.1, 0.2, 0.3] }));

      const result = await settle(embed('test text', 'nomic-embed'));

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual([0.1, 0.2, 0.3]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should retry on HTTP 502 and succeed on third attempt', async () => {
      fetchSpy
        .mockResolvedValueOnce(serverErrorResponse(502))
        .mockResolvedValueOnce(serverErrorResponse(503))
        .mockResolvedValueOnce(okResponse({ models: [] }));

      const result = await settle(listModels());

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  // ── Typed OllamaError on permanent failure ─────────────────────────

  describe('typed OllamaError on permanent failure', () => {
    it('should throw OllamaError after all retry attempts exhausted (network errors)', async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await settle(listModels());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(OllamaError);
        expect((result.error as Error).message).toMatch(/unreachable/i);
      }
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('should throw OllamaError after all retry attempts exhausted (5xx errors)', async () => {
      fetchSpy
        .mockResolvedValueOnce(serverErrorResponse(500))
        .mockResolvedValueOnce(serverErrorResponse(500))
        .mockResolvedValueOnce(serverErrorResponse(500));

      const result = await settle(embed('test', 'nomic-embed'));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(OllamaError);
      }
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('should include endpoint info in OllamaError', async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await settle(chat([{ role: 'user', content: 'hi' }], 'llama3'));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error as InstanceType<typeof OllamaError>;
        expect(err).toBeInstanceOf(OllamaError);
        expect(err.endpoint).toBe('/api/chat');
        expect(err.name).toBe('OllamaError');
      }
    });

    it('should include statusCode in OllamaError for 5xx failures', async () => {
      fetchSpy
        .mockResolvedValueOnce(serverErrorResponse(502))
        .mockResolvedValueOnce(serverErrorResponse(502))
        .mockResolvedValueOnce(serverErrorResponse(502));

      const result = await settle(embed('test', 'bad-model'));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error as InstanceType<typeof OllamaError>;
        expect(err).toBeInstanceOf(OllamaError);
        expect(err.statusCode).toBe(502);
        expect(err.endpoint).toBe('/api/embeddings');
      }
    });

    it('should not have statusCode for network errors', async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await settle(listModels());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error as InstanceType<typeof OllamaError>;
        expect(err).toBeInstanceOf(OllamaError);
        expect(err.statusCode).toBeUndefined();
      }
    });
  });

  // ── Mixed failure scenarios ────────────────────────────────────────

  describe('mixed failure scenarios', () => {
    it('should handle network error followed by 5xx followed by success', async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(serverErrorResponse(503))
        .mockResolvedValueOnce(okResponse({ models: [{ name: 'codellama' }] }));

      const result = await settle(listModels());

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual([{ name: 'codellama' }]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  // ── Successful requests without retries ────────────────────────────

  describe('successful requests', () => {
    it('should not retry on successful response', async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({ models: [{ name: 'llama3' }] }));

      const result = await settle(listModels());

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual([{ name: 'llama3' }]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
