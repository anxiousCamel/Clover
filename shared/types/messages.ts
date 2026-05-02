/**
 * Message and completion-related interfaces for Clover.
 */

/** A single message in a conversation. */
export interface Message {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  tool_call_id?: string;
  created_at?: string;
}

/** Tool definition sent alongside a completion request. */
export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Request payload for an LLM completion. */
export interface CompletionRequest {
  messages: Message[];
  tools?: Tool[];
  model?: string;
  stream?: boolean;
}

/** A tool call emitted by the model during completion. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Token-usage statistics for a completion. */
export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
}

/** A single chunk in a streamed completion response. */
export interface CompletionChunk {
  type: 'token' | 'tool_call' | 'usage';
  token?: string;
  toolCall?: ToolCall;
  usage?: UsageStats;
}
