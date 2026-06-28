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
export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  private readonly responses: string[];
  private cursor = 0;
  lastRequest?: StructuredRequest;
  readonly requests: StructuredRequest[] = [];

  constructor(responses: string | string[]) {
    this.responses = Array.isArray(responses) ? responses : [responses];
    if (this.responses.length === 0) this.responses.push('');
  }

  async completeStructured(req: StructuredRequest): Promise<string> {
    this.lastRequest = req;
    this.requests.push(req);
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
