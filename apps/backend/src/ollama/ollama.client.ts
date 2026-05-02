import type { Message } from '@clover/shared';
import { config } from '../config/config.js';

/**
 * Typed error thrown when Ollama is unreachable or returns a non-OK response.
 */
export class OllamaError extends Error {
  public readonly statusCode?: number;
  public readonly endpoint: string;

  constructor(message: string, endpoint: string, statusCode?: number) {
    super(message);
    this.name = 'OllamaError';
    this.endpoint = endpoint;
    this.statusCode = statusCode;
  }
}

/** Shape returned by GET /api/tags */
export interface OllamaModelInfo {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: Record<string, unknown>;
}

/**
 * Perform a fetch with exponential-backoff retry.
 *
 * Retries on network errors and 5xx responses.
 * Throws OllamaError after all attempts are exhausted.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  endpoint: string,
): Promise<Response> {
  const { retryAttempts, retryBackoffMs } = config.ollama;

  let lastError: unknown;

  for (let attempt = 0; attempt < retryAttempts; attempt++) {
    try {
      const res = await fetch(url, init);

      // Do not retry on server errors (500) for Ollama, as it usually means a crash/OOM
      if (res.status >= 500) {
        const body = await res.text().catch(() => '');
        throw new OllamaError(
          `Ollama returned HTTP ${res.status}: ${body}`,
          endpoint,
          res.status,
        );
      }

      // Non-5xx errors are not retried — surface immediately
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new OllamaError(
          `Ollama ${endpoint} failed: HTTP ${res.status} — ${body}`,
          endpoint,
          res.status,
        );
      }

      return res;
    } catch (err) {
      if (err instanceof OllamaError) {
        lastError = err;
      } else {
        // Network / DNS / connection-refused errors
        lastError = new OllamaError(
          `Ollama unreachable at ${url}: ${(err as Error).message}`,
          endpoint,
        );
      }

      if (attempt < retryAttempts - 1) {
        await sleep(retryBackoffMs * Math.pow(2, attempt));
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a chat completion request to Ollama and return the assistant message.
 * Supports streaming if a callback is provided.
 */
export async function chat(
  messages: Message[],
  model: string,
  tools?: any[],
  onToken?: (token: string) => void,
): Promise<{ content: string; tool_calls?: any[] }> {
  const url = `${config.ollama.host}/api/chat`;

  const body = JSON.stringify({
    model,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      tool_calls: (m as any).tool_calls,
      tool_call_id: (m as any).tool_call_id,
    })),
    ...(tools && tools.length > 0 ? { tools } : {}),
    stream: !!onToken,
  });

  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    },
    '/api/chat',
  );


  if (onToken) {
    let fullContent = '';
    let toolCalls: any[] = [];
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Ollama response body is not readable');

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            fullContent += json.message.content;
            onToken(json.message.content);
          }
          if (json.message?.tool_calls) {
            toolCalls = [...toolCalls, ...json.message.tool_calls];
          }
          if (json.done) break;
        } catch { /* skip partial lines */ }
      }
    }
    return { content: fullContent, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };
  } else {
    const json = (await res.json()) as { message?: { content?: string; tool_calls?: any[] } };
    return {
      content: json.message?.content ?? '',
      tool_calls: json.message?.tool_calls,
    };
  }
}

/**
 * Generate an embedding vector for the given text.
 */
export async function embed(text: string, model: string): Promise<number[]> {
  const url = `${config.ollama.host}/api/embeddings`;

  const body = JSON.stringify({ model, prompt: text });

  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    },
    '/api/embeddings',
  );

  const json = (await res.json()) as { embedding?: number[] };

  if (!json.embedding) {
    throw new OllamaError(
      'Ollama /api/embeddings returned no embedding field',
      '/api/embeddings',
    );
  }

  return json.embedding;
}

/**
 * List models currently available in Ollama.
 */
export async function listModels(): Promise<OllamaModelInfo[]> {
  const url = `${config.ollama.host}/api/tags`;

  const res = await fetchWithRetry(
    url,
    { method: 'GET' },
    '/api/tags',
  );

  const json = (await res.json()) as { models?: OllamaModelInfo[] };
  return json.models ?? [];
}
