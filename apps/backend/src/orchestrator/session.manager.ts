/**
 * Session Manager — higher-level session management on top of the SQLite
 * store.  Handles session creation, message persistence, model selection,
 * and context-window construction for the Orchestrator.
 *
 * The context window is assembled in a strict order:
 *   [system_prompt, ...memoryChunks (as Context block), ...history, userMessage]
 *
 * @module orchestrator/session-manager
 */

import type { Message, Chunk } from '@clover/shared';
import { config } from '../config/config.js';
import { SQLiteStore, type Session } from '../storage/sqlite.store.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let store: SQLiteStore;

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise the session manager with a SQLite store instance.
 * Must be called once at application startup before any other method.
 */
export function init(sqliteStore: SQLiteStore): void {
  store = sqliteStore;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a new session for the given workspace path.
 *
 * Delegates to {@link SQLiteStore.createSession} and returns the full
 * session record including the generated id and timestamps.
 *
 * @param workspacePath - Absolute path to the user's workspace directory.
 * @returns The newly created {@link Session} record.
 */
export function createSession(workspacePath: string): Session {
  return store.createSession(workspacePath);
}

/**
 * Retrieve an existing session by id.
 *
 * @param sessionId - The session UUID.
 * @returns The {@link Session} record, or `undefined` if not found.
 */
export function getSession(sessionId: string): Session | undefined {
  return store.getSession(sessionId);
}

/**
 * Delete a session and all associated messages (cascade).
 *
 * @param sessionId - The session UUID to remove.
 */
export function deleteSession(sessionId: string): void {
  store.deleteSession(sessionId);
}

// ---------------------------------------------------------------------------
// Message persistence
// ---------------------------------------------------------------------------

/**
 * Load the most recent conversation messages for a session.
 *
 * @param sessionId - The session UUID.
 * @param limit     - Maximum number of messages to return (default from config).
 * @returns An array of {@link Message} objects ordered by creation time ascending.
 */
export function loadHistory(
  sessionId: string,
  limit: number = config.session.historyLimit,
): Message[] {
  return store.getHistory(sessionId, limit);
}

/**
 * Persist a single message (user or assistant) to the session history.
 *
 * Also touches the session's `updated_at` timestamp via the underlying
 * store.
 *
 * @param sessionId - The session UUID.
 * @param message   - The {@link Message} to persist.
 */
export function saveMessage(sessionId: string, message: Message): void {
  store.saveMessage(sessionId, message);
}

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------

/**
 * Persist the selected model for a session so the choice survives page
 * reloads.
 *
 * Updates the `model` column in the sessions table directly.
 *
 * @param sessionId - The session UUID.
 * @param model     - The Ollama model name to persist.
 */
export function setModel(sessionId: string, model: string): void {
  store.updateModel(sessionId, model);
}

/**
 * Retrieve the persisted model for a session.
 *
 * @param sessionId - The session UUID.
 * @returns The model name, or `null` if none has been selected.
 */
export function getModel(sessionId: string): string | null {
  const session = store.getSession(sessionId);
  return session?.model ?? null;
}

// ---------------------------------------------------------------------------
// Context window construction
// ---------------------------------------------------------------------------

/**
 * Build the full context window that will be sent to the AI model.
 *
 * The window is assembled in the following order:
 * 1. **System prompt** — always first.
 * 2. **Memory chunks** — RAG-retrieved context formatted as a single
 *    system message with a "Context" block.
 * 3. **Conversation history** — the last N messages from SQLite.
 * 4. **User message** — the current turn's message (last in history).
 *
 * @param sessionId    - The session UUID (used to load history).
 * @param memoryChunks - RAG-retrieved {@link Chunk} objects to inject.
 * @param systemPrompt - The system prompt text for the active agent.
 * @returns An ordered array of {@link Message} objects ready for the
 *          completion request.
 */
export function buildContextWindow(
  sessionId: string,
  memoryChunks: Chunk[],
  systemPrompt: string,
): Message[] {
  const messages: Message[] = [];

  // 1. System prompt
  messages.push({ role: 'system', content: systemPrompt });

  // 2. Memory chunks as a Context block (only if there are chunks)
  if (memoryChunks.length > 0) {
    const contextBlock = formatMemoryChunks(memoryChunks);
    messages.push({ role: 'system', content: contextBlock });
  }

  // 3. Conversation history (already ordered ASC by created_at)
  const history = loadHistory(sessionId);
  messages.push(...history);

  return messages;
}

// ── helpers ──────────────────────────────────────────────

/**
 * Format an array of memory chunks into a single "Context" block string
 * suitable for injection as a system message.
 *
 * Each chunk is separated by a blank line and prefixed with its source.
 */
function formatMemoryChunks(chunks: Chunk[]): string {
  const lines = chunks.map((chunk) => {
    const source = chunk.source ? `[${chunk.source}]` : '[memory]';
    return `${source} ${chunk.text}`;
  });

  return `<Context>\n${lines.join('\n\n')}\n</Context>`;
}
