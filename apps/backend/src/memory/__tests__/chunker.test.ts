/**
 * Unit tests for Chunker.
 *
 * Validates: Requirements 10.4
 *
 * Tests that the Chunker splits text into ≤512-token chunks with 50-token
 * overlap, preserving sentence boundaries where possible.
 */
import { describe, it, expect, vi } from 'vitest';
import { get_encoding } from 'tiktoken';

// Mock config before importing the chunker
vi.mock('../../config/config.js', () => ({
  config: {
    memory: {
      chunkSize: 512,
      chunkOverlap: 50,
    },
  },
}));

const { split } = await import('../chunker.js');

const encoder = get_encoding('cl100k_base');

/** Count tokens in a string using the same encoder the chunker uses. */
function countTokens(text: string): number {
  return encoder.encode(text).length;
}

describe('Chunker', () => {
  // ── Chunk size limit ───────────────────────────────────────────────

  describe('chunk size does not exceed 512 tokens', () => {
    it('should return a single chunk for short text', () => {
      const text = 'Hello, world. This is a short sentence.';
      const chunks = split(text);

      expect(chunks).toHaveLength(1);
      expect(countTokens(chunks[0].text)).toBeLessThanOrEqual(512);
    });

    it('should keep every chunk within 512 tokens for long text', () => {
      // Build a text that is well over 512 tokens
      const sentence = 'The quick brown fox jumps over the lazy dog. ';
      const text = sentence.repeat(200);

      expect(countTokens(text)).toBeGreaterThan(512);

      const chunks = split(text);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(countTokens(chunk.text)).toBeLessThanOrEqual(512);
      }
    });

    it('should handle text that is exactly 512 tokens', () => {
      // Build text token-by-token until we hit exactly 512
      const word = 'word ';
      let text = '';
      while (countTokens(text + word) < 512) {
        text += word;
      }
      // Pad to exactly 512 tokens
      while (countTokens(text) < 512) {
        text += 'a';
      }

      const chunks = split(text);

      // With sentence-boundary snapping the first chunk may be trimmed,
      // producing a second overlap chunk. Either way every chunk must
      // stay within the 512-token limit.
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      for (const chunk of chunks) {
        expect(countTokens(chunk.text)).toBeLessThanOrEqual(512);
      }
    });
  });

  // ── Overlap between consecutive chunks ─────────────────────────────

  describe('overlap between consecutive chunks', () => {
    it('should produce overlapping text between consecutive chunks', () => {
      // Generate text long enough to produce multiple chunks
      const sentence = 'This is sentence number one. ';
      const text = sentence.repeat(200);

      const chunks = split(text);

      expect(chunks.length).toBeGreaterThan(1);

      // Consecutive chunks should share some text content (overlap region)
      for (let i = 0; i < chunks.length - 1; i++) {
        const currentEnd = chunks[i].text;
        const nextStart = chunks[i + 1].text;

        // The tail of the current chunk should appear at the start of the next
        // chunk due to the 50-token overlap. We check that the beginning of
        // the next chunk overlaps with the end of the current chunk.
        const tailOfCurrent = currentEnd.slice(-50);
        const headOfNext = nextStart.slice(0, 200);

        // At least some portion of the tail should appear in the head of next
        expect(headOfNext).toContain(tailOfCurrent.trim().slice(0, 20));
      }
    });

    it('should produce more chunks than a non-overlapping split would', () => {
      const sentence = 'Alpha beta gamma delta epsilon. ';
      const text = sentence.repeat(200);

      const chunks = split(text);
      const totalTokens = countTokens(text);

      // With overlap, we expect more chunks than ceil(totalTokens / 512)
      const nonOverlapCount = Math.ceil(totalTokens / 512);
      expect(chunks.length).toBeGreaterThanOrEqual(nonOverlapCount);
    });
  });

  // ── Sentence boundary preservation ─────────────────────────────────

  describe('sentence boundary preservation', () => {
    it('should end non-final chunks at a sentence boundary when possible', () => {
      // Build text with clear sentence boundaries that will span multiple chunks
      const sentences: string[] = [];
      for (let i = 0; i < 300; i++) {
        sentences.push(`Sentence number ${i} provides important context.`);
      }
      const text = sentences.join(' ');

      const chunks = split(text);

      expect(chunks.length).toBeGreaterThan(1);

      // Non-final chunks should end with sentence-ending punctuation
      for (let i = 0; i < chunks.length - 1; i++) {
        const trimmed = chunks[i].text.trimEnd();
        const lastChar = trimmed[trimmed.length - 1];
        expect(['.', '!', '?']).toContain(lastChar);
      }
    });

    it('should not snap to sentence boundary for the final chunk', () => {
      // The final chunk should contain whatever text remains, even if it
      // doesn't end with sentence punctuation
      const sentence = 'Complete sentence here. ';
      const text = sentence.repeat(150) + 'trailing text without punctuation';

      const chunks = split(text);
      const lastChunk = chunks[chunks.length - 1];

      expect(lastChunk.text).toContain('trailing text without punctuation');
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should return empty array for empty text', () => {
      const chunks = split('');
      expect(chunks).toEqual([]);
    });

    it('should assign unique ids to each chunk', () => {
      const text = 'Some text. '.repeat(200);
      const chunks = split(text);

      const ids = chunks.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should use provided source metadata', () => {
      const chunks = split('Hello world.', { source: 'vault' });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].source).toBe('vault');
    });

    it('should default source to "unknown" when no metadata provided', () => {
      const chunks = split('Hello world.');

      expect(chunks).toHaveLength(1);
      expect(chunks[0].source).toBe('unknown');
    });
  });
});
