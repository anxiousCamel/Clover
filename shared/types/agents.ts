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
  /** Optional flag to mark this agent as a fallback when no other agents match. */
  isFallback?: boolean;
  /** Optional function to determine if this agent should handle the message. */
  matchesIntent?: (message: string, context?: AgentContext) => boolean;
  maxTurns: number;
}

/** ---------------------------------------------------------------------------
 * Task & Execution State
 * --------------------------------------------------------------------------- */

export interface TaskStep {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
}

export interface ExecutionBudget {
  maxFileWrites: number;
  maxCommands: number;
  maxTurns: number;
}

export interface TaskState {
  id: string;
  goal: string;
  currentStep?: string;
  steps: TaskStep[];
  attempts: number;
  status: 'running' | 'blocked' | 'done' | 'failed';
  budget: ExecutionBudget;
}

/** Contextual information available to an agent's intent matcher and execution. */
export interface AgentContext {
  sessionId: string;
  workspacePath: string;
  recentTools?: string[];
  /** The current active task state, if any. */
  task?: TaskState;
}
