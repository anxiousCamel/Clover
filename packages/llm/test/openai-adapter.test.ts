import { describe, expect, it } from 'vitest';

import type { StructuredRequest } from '@clover/llm';
import { OpenAiCompatibleAdapter } from '@clover/llm';

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** fetch falso que captura a requisição e devolve uma resposta OpenAI-like. */
function fakeFetch(captured: CapturedRequest[], content = '{"ok":true}') {
  return (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    captured.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content } }] }),
    };
  }) as unknown as typeof fetch;
}

const req: StructuredRequest = {
  system: 'você é o planner',
  prompt: 'faça um plano',
  schema: { type: 'object', properties: { version: { const: '1' } } },
};

describe('OpenAiCompatibleAdapter', () => {
  it('uses json_schema structured outputs when supported', async () => {
    const captured: CapturedRequest[] = [];
    const adapter = new OpenAiCompatibleAdapter({
      baseURL: 'https://openrouter.ai/api/v1/',
      apiKey: 'sk-test',
      model: 'anthropic/claude-3.5',
      supportsStructuredOutputs: true,
      fetchImpl: fakeFetch(captured),
    });

    const out = await adapter.completeStructured(req);
    expect(out).toBe('{"ok":true}');

    const r = captured[0];
    expect(r.url).toBe('https://openrouter.ai/api/v1/chat/completions'); // barra final removida
    expect(r.headers.authorization).toBe('Bearer sk-test');
    const rf = r.body.response_format as { type: string; json_schema?: { schema: unknown } };
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema?.schema).toEqual(req.schema);
    expect(r.body.model).toBe('anthropic/claude-3.5');
  });

  it('gracefully degrades to json_object + schema-in-prompt when unsupported', async () => {
    const captured: CapturedRequest[] = [];
    const adapter = new OpenAiCompatibleAdapter({
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey: 'gsk',
      supportsStructuredOutputs: false,
      fetchImpl: fakeFetch(captured),
    });

    await adapter.completeStructured(req);
    const r = captured[0];
    expect((r.body.response_format as { type: string }).type).toBe('json_object');
    const messages = r.body.messages as Array<{ role: string; content: string }>;
    // o schema foi embutido no system prompt (degradação graciosa)
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('schema');
    expect(messages[0].content).toContain('version');
  });

  it('omits the Authorization header when no apiKey is set', async () => {
    const captured: CapturedRequest[] = [];
    const adapter = new OpenAiCompatibleAdapter({
      baseURL: 'http://localhost:1234/v1',
      supportsStructuredOutputs: true,
      fetchImpl: fakeFetch(captured),
    });
    await adapter.completeStructured(req);
    expect(captured[0].headers.authorization).toBeUndefined();
  });

  it('throws on non-ok HTTP responses', async () => {
    const adapter = new OpenAiCompatibleAdapter({
      baseURL: 'https://x/v1',
      fetchImpl: (async () => ({ ok: false, status: 401, statusText: 'Unauthorized' })) as unknown as typeof fetch,
    });
    await expect(adapter.completeStructured(req)).rejects.toThrow(/401/);
  });
});
