/**
 * Context Compressor — manages the size of the AI context window.
 *
 * Implements summarization and pruning strategies to keep the conversation
 * history within model limits while preserving critical task information.
 *
 * @module orchestrator/context-compressor
 */

import type { Message } from '@clover/shared';

const MAX_HISTORY_CHARS = 20000; // ~5k tokens heuristic

/**
 * Prune or summarize history if it exceeds the character budget.
 * Returns a compressed version of the message history.
 */
export async function compressHistory(
  messages: Message[],
): Promise<Message[]> {
  const totalChars = messages.reduce((acc, msg) => acc + msg.content.length, 0);

  if (totalChars < MAX_HISTORY_CHARS) {
    return messages;
  }

  // Simple pruning strategy: keep system message, first 2 messages (start),
  // and last 6 messages (current context).
  const systemMessage = messages.find(m => m.role === 'system');
  const start = messages.filter(m => m.role !== 'system').slice(0, 2);
  const end = messages.filter(m => m.role !== 'system').slice(-6);

  const compressed: Message[] = [];
  if (systemMessage) compressed.push(systemMessage);
  
  compressed.push({
    role: 'system',
    content: '[... older history pruned for brevity ...]'
  });
  
  compressed.push(...start);
  compressed.push(...end);

  return compressed;
}
