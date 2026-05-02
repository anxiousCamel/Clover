import { get_encoding } from 'tiktoken';
import { v4 as uuidv4 } from 'uuid';
import type { Chunk } from '@clover/shared';
import { config } from '../config/config.js';

const encoder = get_encoding('cl100k_base');

/**
 * Split text into token-bounded chunks with overlap, snapping to sentence
 * boundaries where possible.
 */
export function split(
  text: string,
  metadata?: { source?: string },
): Chunk[] {
  const { chunkSize, chunkOverlap } = config.memory;
  const tokens = encoder.encode(text);

  if (tokens.length === 0) return [];

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < tokens.length) {
    const end = Math.min(start + chunkSize, tokens.length);
    const windowTokens = tokens.slice(start, end);
    let decoded = new TextDecoder().decode(encoder.decode(windowTokens));

    // Snap to sentence boundary if one exists in the last ~20% of the chunk
    if (end < tokens.length) {
      decoded = snapToSentenceBoundary(decoded);
    }

    chunks.push({
      id: uuidv4(),
      source: metadata?.source ?? 'unknown',
      text: decoded,
    });

    // Advance by chunkSize - chunkOverlap, but at least 1 token
    const step = Math.max(chunkSize - chunkOverlap, 1);
    start += step;
  }

  return chunks;
}

/**
 * If a sentence-ending punctuation (. ! ?) exists in the last ~20% of the
 * text, trim the chunk to end right after that punctuation.
 */
function snapToSentenceBoundary(text: string): string {
  const cutoff = Math.floor(text.length * 0.8);
  const tail = text.slice(cutoff);

  // Find the LAST sentence boundary in the tail
  const match = tail.match(/.*[.!?]/s);
  if (match) {
    const boundaryEnd = cutoff + match[0].length;
    return text.slice(0, boundaryEnd).trimEnd();
  }

  return text;
}
