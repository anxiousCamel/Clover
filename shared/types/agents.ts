/**
 * Agent-related interfaces for Clover's multi-agent system.
 */

/** Contextual information available to an agent's intent matcher. */
export interface AgentContext {
  sessionId: string;
  workspacePath: string;
  recentTools?: string[];
}

/** Runtime status of an agent. */
export type AgentStatus = 'idle' | 'running' | 'done' | 'error';

/** A specialised agent that handles a category of user intents. */
export interface Agent {
  name: string;
  systemPrompt: string;
  allowedTools: string[];
  matchesIntent: (message: string, context?: AgentContext) => boolean;
  maxTurns: number;
}
