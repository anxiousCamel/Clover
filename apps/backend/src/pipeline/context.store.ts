/**
 * Operational Context Store — in-memory, per-session transient state.
 *
 * Allows the pipeline to resolve deictic references ("coloca lá", "salva isso")
 * by remembering the last file path, content, and tool result between turns.
 *
 * @module pipeline/context.store
 */

import type { OperationalContext, IntentLabel } from './intent.types.js';

const store = new Map<string, OperationalContext>();

/** Get the operational context for a session (always returns an object). */
export function getContext(sessionId: string): OperationalContext {
  return store.get(sessionId) ?? {};
}

/** Merge a partial update into a session's operational context. */
export function updateContext(sessionId: string, patch: Partial<OperationalContext>): void {
  const current = store.get(sessionId) ?? {};
  store.set(sessionId, { ...current, ...patch });
}

/** Convenience: update just the last file path. */
export function setLastFilePath(sessionId: string, filePath: string): void {
  updateContext(sessionId, { lastFilePath: filePath });
}

/** Convenience: update the last generated content. */
export function setLastGeneratedContent(sessionId: string, content: string): void {
  updateContext(sessionId, { lastGeneratedContent: content });
}

/** Convenience: update the last intent. */
export function setLastIntent(sessionId: string, intent: IntentLabel): void {
  updateContext(sessionId, { lastIntent: intent });
}

/** Clear the operational context for a session. */
export function clearContext(sessionId: string): void {
  store.delete(sessionId);
}

/** Return all session IDs with active context (for inspection/debugging). */
export function listSessions(): string[] {
  return Array.from(store.keys());
}
