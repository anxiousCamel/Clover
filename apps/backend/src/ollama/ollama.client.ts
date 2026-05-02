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

      // Retry on server errors (5xx)
      if (res.status >= 500) {
        lastError = new OllamaError(
          `Ollama returned HTTP ${res.status}`,
          endpoint,
          res.status,
        );
        if (attempt < retryAttempts - 1) {
          await sleep(retryBackoffMs * Math.pow(2, attempt));
          continue;
        }
        throw lastError;
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
 * Send a chat completion request to Ollama and return the assistant message content.
 */
export async function chat(messages: Message[], model: string): Promise<string> {
  const url = `${config.ollama.host}/api/chat`;

  const body = JSON.stringify({
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
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

  const json = (await res.json()) as { message?: { content?: string } };
  return json.message?.content ?? '';
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
