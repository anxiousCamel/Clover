/**
 * Configuration interfaces for Clover.
 */

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
