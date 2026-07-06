/**
 * ToolCallingAgent — ReAct loop via native function calling.
 *
 * Bypasses Plan IR entirely. The LLM receives tools in the format it was
 * trained on (OpenAI tool_calls), calls one at a time, sees the result, and
 * decides the next action. Works with small models (qwen2.5-coder, phi, etc.)
 * because it doesn't require generating a custom JSON DAG format.
 *
 * FALLBACK: Models that don't emit native tool_calls (e.g. qwen2.5-coder
 * outputting ```json {"name":"...","arguments":{...}}``` as text) are handled
 * by extractTextToolCall(). Results are injected as user messages so even
 * models without tool/function roles can see and use them.
 */

import { randomUUID } from 'node:crypto';
import type { IRValue, PlanIR } from '@clover/contracts';
import type { Kernel } from '@clover/kernel';
import type { ChatMessage, LlmProvider, ToolCall } from '@clover/llm';
import type { ToolSearch } from '@clover/tool-search';

const TOOL_SYSTEM = [
  'Você é o CloverOS, um assistente pessoal inteligente com acesso a ferramentas reais.',
  'Responda sempre em português.',
  '',
  'REGRAS DE USO DE FERRAMENTAS:',
  '- Usuário pede conteúdo de arquivo → use read_file_paginated.',
  '- Usuário pede lista de arquivos/pasta → use list_files.',
  '- Usuário pede abrir arquivo → use open_file.',
  '- Usuário pede criar/apagar/mover arquivo → use a ferramenta correspondente.',
  '- Perguntas gerais de conhecimento ou conversa → responda com texto diretamente.',
  '',
  'PROIBIDO dizer "não tenho capacidade", "não posso acessar" ou similar quando há ferramentas disponíveis.',
  'Você TEM as ferramentas listadas. Use-as. Não invente limitações inexistentes.',
].join('\n');

const MAX_STEPS = 6;

/** Detects when the model falsely claims it cannot use tools it actually has. */
function isHallucination(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    (lower.includes('não tenho') && (lower.includes('capacidade') || lower.includes('acesso'))) ||
    lower.includes('não posso acessar') ||
    lower.includes('não posso ler') ||
    lower.includes('não consigo acessar') ||
    lower.includes('não consigo ler') ||
    (lower.includes('como assistente') && lower.includes('não'))
  );
}

/**
 * Extracts a tool call from model content when the model outputs JSON text
 * instead of native tool_calls. Handles both ```json ... ``` blocks and raw
 * JSON with {"name":"...","arguments":{...}} structure.
 */
function extractTextToolCall(content: string, toolNames: Set<string>): ToolCall | null {
  // Try code block first, then bare content
  const codeBlock = /```(?:json)?\s*\n?([\s\S]*?)\n?```/.exec(content);
  const candidates = codeBlock ? [codeBlock[1].trim(), content.trim()] : [content.trim()];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (
        typeof parsed['name'] === 'string' &&
        toolNames.has(parsed['name']) &&
        typeof parsed['arguments'] === 'object' &&
        parsed['arguments'] !== null
      ) {
        return {
          id: `text-call-0`,
          function: {
            name: parsed['name'],
            arguments: parsed['arguments'] as Record<string, unknown>,
          },
        };
      }
    } catch {
      // not valid JSON
    }
  }
  return null;
}

export interface ToolAgentHistory {
  user: string;
  assistant: string;
}

/**
 * Pre-formats a tool result for the LLM so it doesn't have to parse raw JSON.
 * Makes it easier for small models to summarize/describe the result.
 */
export function formatToolResult(output: unknown): string {
  if (output === null || output === undefined) return '(sem resultado)';

  if (typeof output === 'string') return output;

  if (Array.isArray(output)) {
    const isDirEntry = (x: unknown): x is { name?: string; type?: string; size?: number } =>
      typeof x === 'object' && x !== null && ('name' in x || 'type' in x);
    if (output.every(isDirEntry)) {
      if (output.length === 0) return '(diretório vazio)';
      return output
        .map((e) => {
          const entry = e as { name?: string; type?: string; size?: number };
          const icon = entry.type === 'dir' ? '📁' : '📄';
          const size = entry.type === 'file' && (entry.size ?? 0) > 0 ? ` (${Math.round((entry.size ?? 0) / 1024)} KB)` : '';
          return `${icon} ${entry.name ?? '?'}${size}`;
        })
        .join('\n');
    }
    return JSON.stringify(output);
  }

  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    if (Array.isArray(obj['entries'])) return formatToolResult(obj['entries']);
    // read_file_paginated returns { lines: [{n, text}], ... }
    if (Array.isArray(obj['lines'])) {
      const lines = obj['lines'] as Array<{ n?: number; text?: string }>;
      if (lines.length === 0) return '(arquivo vazio)';
      return lines.map((l) => l.text ?? '').join('\n');
    }
    if (typeof obj['content'] === 'string') return obj['content'];
    if (typeof obj['message'] === 'string') return obj['message'];
    if (typeof obj['output'] === 'string') return obj['output'];
    if (obj['output'] !== undefined) return formatToolResult(obj['output']);
  }

  return JSON.stringify(output);
}

export class ToolCallingAgent {
  constructor(
    private readonly provider: LlmProvider,
    private readonly kernel: Kernel,
    private readonly workspacePath: string,
    private readonly toolSearch?: ToolSearch,
    private readonly maxTools = 8,
  ) {}

  get supportsTools(): boolean {
    return typeof this.provider.completeWithTools === 'function';
  }

  async run(text: string, history: ToolAgentHistory[]): Promise<string> {
    if (!this.provider.completeWithTools) return '(provider não suporta function calling)';

    const allDescriptors = this.kernel.listTools();
    const relevant = this.toolSearch
      ? this.toolSearch.find(text, this.maxTools, allDescriptors)
      : allDescriptors.slice(0, this.maxTools);

    // Always include core file tools regardless of query
    const coreNames = new Set(['list_files', 'read_file_paginated', 'open_file']);
    const coreTools = allDescriptors.filter((t) => coreNames.has(t.name));
    const relevantNames = new Set(relevant.map((t) => t.name));
    const mergedDescriptors = [...relevant, ...coreTools.filter((t) => !relevantNames.has(t.name))];

    const toolNameSet = new Set(mergedDescriptors.map((t) => t.name));
    const tools = mergedDescriptors.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));

    const messages: ChatMessage[] = [
      ...history.flatMap((h) => [
        { role: 'user' as const, content: h.user },
        { role: 'assistant' as const, content: h.assistant },
      ]),
      { role: 'user', content: text },
    ];

    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await this.provider.completeWithTools({
        system: TOOL_SYSTEM,
        messages,
        tools,
      });

      const hasNativeCalls = response.tool_calls && response.tool_calls.length > 0;

      if (!hasNativeCalls) {
        const content = response.content.trim();

        // Fallback: model printed tool call as JSON text instead of native tool_calls
        const textCall = extractTextToolCall(content, toolNameSet);
        if (textCall) {
          messages.push({ role: 'assistant', content });
          const result = await this._executeTool(textCall);
          const formatted = formatToolResult(result);
          // Inject as user message — compatible with models that don't understand role:tool
          messages.push({
            role: 'user',
            content: `[Resultado de ${textCall.function.name}]\n${formatted}\n\nCom base nesses dados, responda em linguagem natural.`,
          });
          continue;
        }

        // Step 0: model hasn't tried any tool yet; if it claims it can't, retry once
        if (step === 0 && content && isHallucination(content)) {
          messages.push({ role: 'assistant', content });
          messages.push({
            role: 'user',
            content:
              'Você TEM ferramentas disponíveis (listadas acima). Use-as AGORA para responder a pergunta anterior. Não diga que não pode — chame a ferramenta.',
          });
          continue;
        }

        return content || '(sem resposta)';
      }

      // Native tool calls — execute them
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      });

      for (const call of response.tool_calls!) {
        const result = await this._executeTool(call);
        const formatted = formatToolResult(result);
        messages.push({
          role: 'tool',
          content: formatted,
          tool_call_id: call.id ?? `call-${step}`,
        });
      }
    }

    return '(limite de passos atingido — tente reformular)';
  }

  private async _executeTool(call: ToolCall): Promise<unknown> {
    const plan: PlanIR = {
      version: '1',
      goalId: `react-${randomUUID()}`,
      nodes: [{ id: 'n1', kind: 'tool_call', tool: call.function.name, args: call.function.arguments as Record<string, IRValue> }],
      edges: [],
      outputs: [{ kind: 'ref', nodeId: 'n1', path: '' }],
    };
    try {
      const result = await this.kernel.submitPlan(plan, { workspacePath: this.workspacePath });
      return result.outputs[0] ?? null;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
