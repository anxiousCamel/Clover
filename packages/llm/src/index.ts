/**
 * @clover/llm — Port de provider de LLM + adapters (RAP Providers; ADR-004).
 *
 * O ponto central da confiabilidade (ADR-004) é **constrained decoding**: o
 * provider recebe um JSON Schema e o modelo é obrigado a produzir uma saída que
 * o satisfaz. Para Ollama isso é feito via `format: <schema>` (structured
 * outputs); para llama.cpp direto, via GBNF (futuro). Aqui definimos o port e
 * dois adapters: `MockProvider` (determinístico, para testes) e
 * `OllamaProvider` (caminho real; exige um Ollama em execução).
 */

import type { JsonSchema } from '@clover/contracts';

/** Requisição de geração estruturada (saída restrita a `schema`). */
export interface StructuredRequest {
  system?: string;
  prompt: string;
  /** A saída DEVE satisfazer este schema (constrained decoding). */
  schema: JsonSchema;
  model?: string;
}

/** Port de provider. A saída é o texto JSON bruto (o caller faz o parse). */
export interface LlmProvider {
  readonly name: string;
  completeStructured(req: StructuredRequest): Promise<string>;
}

/**
 * Provider determinístico para testes. Devolve respostas pré-definidas em
 * sequência (a última se repete). Registra a última requisição recebida.
 */
/** Função que deriva a resposta a partir da requisição (mocks dinâmicos). */
export type MockResponder = (req: StructuredRequest) => string;

export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  private readonly responses: string[];
  private readonly responder?: MockResponder;
  private cursor = 0;
  lastRequest?: StructuredRequest;
  readonly requests: StructuredRequest[] = [];

  constructor(responses: string | string[] | MockResponder) {
    if (typeof responses === 'function') {
      this.responder = responses;
      this.responses = [];
    } else {
      this.responses = Array.isArray(responses) ? responses : [responses];
      if (this.responses.length === 0) this.responses.push('');
    }
  }

  async completeStructured(req: StructuredRequest): Promise<string> {
    this.lastRequest = req;
    this.requests.push(req);
    if (this.responder) return this.responder(req);
    const idx = Math.min(this.cursor, this.responses.length - 1);
    this.cursor++;
    return this.responses[idx];
  }
}

export interface OllamaOptions {
  host?: string;
  model?: string;
  /** Timeout por requisição (ms). */
  timeoutMs?: number;
}

/**
 * Adapter real para Ollama usando structured outputs (`format` = JSON Schema).
 * Caminho de integração: NÃO é exercido nos testes offline (requer um Ollama
 * em execução). Mantido fino e atrás do port.
 */
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  constructor(private readonly opts: OllamaOptions = {}) {}

  async completeStructured(req: StructuredRequest): Promise<string> {
    const host = this.opts.host ?? process.env.CLOVER_OLLAMA_HOST ?? 'http://localhost:11434';
    const model = req.model ?? this.opts.model ?? 'qwen2.5-coder';

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 120_000);
    try {
      const res = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          // Structured outputs: a saída fica restrita ao schema da IR.
          format: req.schema,
          messages: [
            ...(req.system ? [{ role: 'system', content: req.system }] : []),
            { role: 'user', content: req.prompt },
          ],
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`OllamaProvider: HTTP ${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as { message?: { content?: string } };
      return json.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface OpenAiCompatibleOptions {
  /** Ex.: https://openrouter.ai/api/v1 · https://api.openai.com/v1 · Groq · DeepSeek */
  baseURL: string;
  apiKey?: string;
  model?: string;
  /** O provedor suporta structured outputs (response_format json_schema)? */
  supportsStructuredOutputs?: boolean;
  timeoutMs?: number;
  /** Injeção de fetch (testes). */
  fetchImpl?: typeof fetch;
}

/**
 * Adapter universal para qualquer provedor **OpenAI-compatible** (OpenRouter,
 * Groq, DeepSeek, OpenAI, ...). Basta trocar `baseURL` + `apiKey`. A injeção da
 * gramática/IR é adaptada graciosamente: usa `response_format: json_schema`
 * quando o provedor suporta structured outputs; senão cai para `json_object` +
 * o schema embutido no prompt (degradação limpa, sem quebrar a tese do ADR-004).
 */
export class OpenAiCompatibleAdapter implements LlmProvider {
  readonly name = 'openai-compatible';

  constructor(private readonly opts: OpenAiCompatibleOptions) {}

  async completeStructured(req: StructuredRequest): Promise<string> {
    const model = req.model ?? this.opts.model ?? 'gpt-4o-mini';
    const doFetch = this.opts.fetchImpl ?? fetch;
    const messages: Array<{ role: string; content: string }> = [];

    let responseFormat: Record<string, unknown>;
    if (this.opts.supportsStructuredOutputs) {
      responseFormat = {
        type: 'json_schema',
        json_schema: { name: 'clover_plan', schema: req.schema, strict: true },
      };
      if (req.system) messages.push({ role: 'system', content: req.system });
    } else {
      responseFormat = { type: 'json_object' };
      const schemaHint = `Responda APENAS com JSON válido que satisfaça este schema: ${JSON.stringify(req.schema)}`;
      messages.push({ role: 'system', content: `${req.system ?? ''}\n${schemaHint}`.trim() });
    }
    messages.push({ role: 'user', content: req.prompt });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 120_000);
    try {
      const res = await doFetch(`${this.opts.baseURL.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify({ model, messages, response_format: responseFormat, stream: false }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`OpenAiCompatibleAdapter: HTTP ${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return json.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }
}
