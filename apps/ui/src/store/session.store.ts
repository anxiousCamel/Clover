/**
 * Session Store — manages the active session, workspace path, and model
 * selection.
 *
 * All backend communication goes through {@link httpClient} so that
 * components never make direct fetch calls.
 *
 * @module store/session.store
 */

import { create } from 'zustand';
import * as httpClient from '../api/http.client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by `POST /api/sessions`. */
interface CreateSessionResponse {
  sessionId: string;
  createdAt: string;
}

/** Ollama model descriptor returned by `GET /api/models`. */
interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

/** Session store state. */
interface SessionState {
  /** Currently active session id, or `null` when no session is active. */
  activeSessionId: string | null;

  /** Workspace path associated with the active session. */
  workspacePath: string;

  /** Currently selected Ollama model name. */
  activeModel: string;

  /** List of available Ollama models fetched from the backend. */
  availableModels: OllamaModel[];

  /** Whether a session operation is in progress. */
  loading: boolean;

  /** Last error from a session operation, if any. */
  error: string | null;
}

/** Session store actions. */
interface SessionActions {
  /** Create a new session for the given workspace path. */
  createSession: (workspacePath: string) => Promise<void>;

  /** Set the active model and persist the selection on the backend. */
  setModel: (model: string) => Promise<void>;

  /** Fetch the list of available models from Ollama. */
  fetchModels: () => Promise<void>;

  /** Set the workspace path locally (no backend call). */
  setWorkspacePath: (path: string) => void;

  /** Clear the active session. */
  clearSession: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSessionStore = create<SessionState & SessionActions>()((set, get) => ({
  // ── State ───────────────────────────────────────────────
  activeSessionId: null,
  workspacePath: '',
  activeModel: '',
  availableModels: [],
  loading: false,
  error: null,

  // ── Actions ─────────────────────────────────────────────

  createSession: async (workspacePath: string) => {
    set({ loading: true, error: null });
    try {
      const response = await httpClient.post<CreateSessionResponse>(
        '/sessions',
        { workspacePath },
      );
      set({
        activeSessionId: response.sessionId,
        workspacePath,
        loading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create session';
      set({ loading: false, error: message });
    }
  },

  setModel: async (model: string) => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;

    set({ error: null });
    try {
      await httpClient.patch('/config/model', {
        sessionId: activeSessionId,
        model,
      });
      set({ activeModel: model });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to set model';
      set({ error: message });
    }
  },

  fetchModels: async () => {
    set({ error: null });
    try {
      const models = await httpClient.get<OllamaModel[]>('/models');
      set({ availableModels: models });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch models';
      set({ error: message });
    }
  },

  setWorkspacePath: (path: string) => {
    set({ workspacePath: path });
  },

  clearSession: () => {
    set({
      activeSessionId: null,
      workspacePath: '',
      activeModel: '',
      error: null,
    });
  },
}));
