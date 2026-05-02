/**
 * Agent Store — tracks agent runtime statuses and active tool calls.
 *
 * Subscribes to WebSocket events (`agent:status`, `tool:executing`,
 * `tool:result`) via {@link wsClient} so the UI can display real-time
 * agent activity.
 *
 * @module store/agent.store
 */

import { create } from 'zustand';
import type { AgentStatus } from '@clover/shared';
import * as wsClient from '../api/ws.client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extended status entry for a single agent. */
interface AgentStatusEntry {
  status: AgentStatus;
  detail?: string;
}

/** A tool call that is currently in progress. */
interface ActiveToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

/** Payload shape for `agent:status` WebSocket events. */
interface AgentStatusEvent {
  agent: string;
  status: AgentStatus;
  detail?: string;
}

/** Payload shape for `tool:executing` WebSocket events. */
interface ToolExecutingEvent {
  toolName: string;
  args: Record<string, unknown>;
}

/** Payload shape for `tool:result` WebSocket events. */
interface ToolResultEvent {
  toolName: string;
  success: boolean;
  output: string;
}

/** Agent store state. */
interface AgentState {
  /** Map of agent name → current status. */
  agentStatuses: Record<string, AgentStatusEntry>;

  /** Tool calls currently being executed. */
  activeToolCalls: ActiveToolCall[];

  /** History of completed tool results for the current turn. */
  toolResults: ToolResultEvent[];
}

/** Agent store actions. */
interface AgentActions {
  /**
   * Subscribe to WebSocket events for agent status and tool activity.
   * Returns an unsubscribe function that removes all listeners.
   */
  subscribe: () => () => void;

  /** Reset all agent statuses and tool call tracking. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAgentStore = create<AgentState & AgentActions>()((set) => ({
  // ── State ───────────────────────────────────────────────
  agentStatuses: {},
  activeToolCalls: [],
  toolResults: [],

  // ── Actions ─────────────────────────────────────────────

  subscribe: () => {
    const unsubStatus = wsClient.onEvent('agent:status', (data) => {
      const event = data as AgentStatusEvent;
      set((state) => ({
        agentStatuses: {
          ...state.agentStatuses,
          [event.agent]: {
            status: event.status,
            detail: event.detail,
          },
        },
      }));
    });

    const unsubToolExec = wsClient.onEvent('tool:executing', (data) => {
      const event = data as ToolExecutingEvent;
      set((state) => ({
        activeToolCalls: [
          ...state.activeToolCalls,
          { toolName: event.toolName, args: event.args },
        ],
      }));
    });

    const unsubToolResult = wsClient.onEvent('tool:result', (data) => {
      const event = data as ToolResultEvent;
      set((state) => ({
        // Remove the completed tool from active calls
        activeToolCalls: state.activeToolCalls.filter(
          (tc) => tc.toolName !== event.toolName,
        ),
        // Add to results history
        toolResults: [...state.toolResults, event],
      }));
    });

    // Return a single unsubscribe function that cleans up all listeners
    return () => {
      unsubStatus();
      unsubToolExec();
      unsubToolResult();
    };
  },

  reset: () => {
    set({
      agentStatuses: {},
      activeToolCalls: [],
      toolResults: [],
    });
  },
}));
