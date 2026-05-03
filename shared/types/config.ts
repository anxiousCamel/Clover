/**
 * Configuration interfaces for Clover.
 */

/** Configuration for a single MCP (Model Context Protocol) server connection. */
export interface MCPServerConfig {
  /** Unique name identifying this MCP server (e.g., "github", "postgres"). */
  name: string;
  /** Transport mechanism: stdio (child process) or sse (HTTP Server-Sent Events). */
  transport: 'stdio' | 'sse';
  /** Command to spawn for stdio transport (required when transport is "stdio"). */
  command?: string;
  /** Arguments passed to the stdio command. */
  args?: string[];
  /** URL for SSE transport (required when transport is "sse"). */
  url?: string;
  /** Optional authentication credentials. */
  auth?: { token: string };
  /** Timeout in milliseconds for tool execution (default: 30000). */
  timeoutMs?: number;
}

/** Top-level application configuration (maps to default.config.json). */
export interface Config {
  gateway: {
    port: number;
    host: string;
    corsOrigin: string;
  };
  openclaude: {
    host: string;
    port: number;
  };
  ollama: {
    host: string;
    retryAttempts: number;
    retryBackoffMs: number;
  };
  memory: {
    dbPath: string;
    topK: number;
    chunkSize: number;
    chunkOverlap: number;
  };
  vault: {
    path: string;
    watchDebounceMs: number;
  };
  execGuard: {
    timeoutMs: number;
  };
  confirmation: {
    timeoutMs: number;
  };
  session: {
    historyLimit: number;
  };
  /** Optional array of MCP server configurations for external tool providers. */
  mcpServers?: MCPServerConfig[];
  /** Maximum subagent recursion depth (default: 3). */
  maxSubagentDepth?: number;
}

/** Model catalogue configuration (maps to models.config.json). */
export interface ModelConfig {
  models: Array<{
    name: string;
    provider: 'ollama';
    capabilities: ('chat' | 'embed')[];
    contextWindow?: number;
    default?: boolean;
  }>;
}
