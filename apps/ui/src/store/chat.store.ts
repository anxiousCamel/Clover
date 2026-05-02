/**
 * Chat Store — manages conversation sessions, messages, and streaming
 * state for the Chat UI.
 *
 * All backend communication goes through {@link httpClient} (REST) and
 * {@link wsClient} (WebSocket) so that components never make direct
 * network calls.
 *
 * The store subscribes to WebSocket events for real-time token streaming
 * (`message:token`), completion (`message:done`), and errors
 * (`message:error`).
 *
 * @module store/chat.store
 */

import { create } from 'zustand';
import type { Message, UsageStats } from '@clover/shared';
import * as httpClient from '../api/http.client.js';
import * as wsClient from '../api/ws.client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Payload shape for `message:token` WebSocket events. */
interface TokenEvent {
  sessionId: string;
  token: string;
}

/** Payload shape for `message:done` WebSocket events. */
interface DoneEvent {
  sessionId: string;
  usage: UsageStats;
}

/** Payload shape for `message:error` WebSocket events. */
interface ErrorEvent {
  sessionId: string;
  error: string;
}

/** Chat store state. */
interface ChatState {
  /** All messages in the active conversation. */
  messages: Message[];

  /** Whether the assistant is currently streaming a response. */
  isStreaming: boolean;

  /** Accumulated text from the current streaming response. */
  currentStreamText: string;

  /** Usage statistics from the last completed response. */
  lastUsage: UsageStats | null;

  /** Last error from a chat operation, if any. */
  error: string | null;
}

/** Chat store actions. */
interface ChatActions {
  /**
   * Send a user message to the backend.
   *
   * Adds the message to the local store immediately, then fires a POST
   * to `/api/chat/message`. Streaming tokens arrive via WebSocket and
   * are accumulated in {@link currentStreamText}.
   */
  sendMessage: (sessionId: string, content: string) => Promise<void>;

  /** Load message history for a session from the backend. */
  loadHistory: (sessionId: string) => Promise<void>;

  /**
   * Subscribe to WebSocket events for message streaming.
   * Returns an unsubscribe function that removes all listeners.
   */
  subscribe: () => () => void;

  /** Clear all messages and reset streaming state. */
  clearMessages: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useChatStore = create<ChatState & ChatActions>()((set, get) => ({
  // ── State ───────────────────────────────────────────────
  messages: [],
  isStreaming: false,
  currentStreamText: '',
  lastUsage: null,
  error: null,

  // ── Actions ─────────────────────────────────────────────

  sendMessage: async (sessionId: string, content: string) => {
    // Optimistically add the user message to the local store
    const userMessage: Message = {
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      isStreaming: true,
      currentStreamText: '',
      error: null,
    }));

    try {
      await httpClient.post('/chat/message', { sessionId, content });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send message';
      set({ isStreaming: false, error: message });
    }
  },

  loadHistory: async (sessionId: string) => {
    set({ error: null });
    try {
      const history = await httpClient.get<Message[]>(
        `/sessions/${sessionId}/history`,
      );
      set({ messages: history });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load history';
      set({ error: message });
    }
  },

  subscribe: () => {
    const unsubToken = wsClient.onEvent('message:token', (data) => {
      const event = data as TokenEvent;
      set((state) => ({
        currentStreamText: state.currentStreamText + event.token,
      }));
    });

    const unsubDone = wsClient.onEvent('message:done', (data) => {
      const event = data as DoneEvent;
      const { currentStreamText } = get();

      // Finalise the streamed response as a complete assistant message
      if (currentStreamText) {
        const assistantMessage: Message = {
          role: 'assistant',
          content: currentStreamText,
          created_at: new Date().toISOString(),
        };

        set((state) => ({
          messages: [...state.messages, assistantMessage],
          isStreaming: false,
          currentStreamText: '',
          lastUsage: event.usage,
        }));
      } else {
        set({
          isStreaming: false,
          currentStreamText: '',
          lastUsage: event.usage,
        });
      }
    });

    const unsubError = wsClient.onEvent('message:error', (data) => {
      const event = data as ErrorEvent;
      set({
        isStreaming: false,
        currentStreamText: '',
        error: event.error,
      });
    });

    // Return a single unsubscribe function that cleans up all listeners
    return () => {
      unsubToken();
      unsubDone();
      unsubError();
    };
  },

  clearMessages: () => {
    set({
      messages: [],
      isStreaming: false,
      currentStreamText: '',
      lastUsage: null,
      error: null,
    });
  },
}));
