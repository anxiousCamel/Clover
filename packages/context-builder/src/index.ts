/**
 * @clover/context-builder — Montagem de contexto sob orçamento (RAP §11.4).
 *
 * Decide EXATAMENTE o que entra no contexto do worker, minimizando tokens.
 * Determinístico e cacheável. Inclui itens por prioridade até estourar o
 * orçamento; o que não cabe é descartado e contabilizado (`dropped`). A
 * contagem de tokens é uma heurística pluggable (default ~ chars/4) para não
 * acoplar a uma tokenizer nativa.
 *
 * Prioridade: system (obrigatório) → consulta (obrigatória) → tools relevantes
 * → histórico recente (mais novo primeiro) → memória (melhor primeiro).
 */

import type { ToolDescriptor } from '@clover/contracts';
import type { ToolSearch } from '@clover/tool-search';

export interface TokenBudget {
  maxTokens: number;
}

export interface HistoryMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface MemoryChunk {
  text: string;
  source?: string;
}

export interface ContextRequest {
  query: string;
  budget: TokenBudget;
  systemPrompt?: string;
  /** Histórico em ordem cronológica (mais antigo → mais novo). */
  history?: HistoryMessage[];
  /** Memória já ranqueada (melhor primeiro). */
  memory?: MemoryChunk[];
  tools?: ToolDescriptor[];
  /** Se fornecido, seleciona as tools relevantes para a consulta. */
  toolSearch?: ToolSearch;
  maxTools?: number;
  /** Estimador de tokens (default: chars/4). */
  estimateTokens?: (text: string) => number;
}

export type ProvenanceKind = 'system' | 'query' | 'history' | 'memory' | 'tool';

export interface ProvenanceRef {
  kind: ProvenanceKind;
  ref: string;
  tokens: number;
}

export interface BuiltContext {
  messages: HistoryMessage[];
  tools: ToolDescriptor[];
  tokensUsed: number;
  provenance: ProvenanceRef[];
  /** Memória que coube no orçamento (ex.: snippets estruturais para o Planner). */
  selectedMemory: MemoryChunk[];
  /** Itens candidatos descartados por falta de orçamento. */
  dropped: number;
}

const defaultEstimate = (text: string): number => Math.ceil(text.length / 4);

export class ContextBuilder {
  build(req: ContextRequest): BuiltContext {
    const est = req.estimateTokens ?? defaultEstimate;
    const max = req.budget.maxTokens;
    const provenance: ProvenanceRef[] = [];
    let used = 0;
    let dropped = 0;
    const fits = (n: number): boolean => used + n <= max;

    // 1) system (obrigatório)
    let systemContent: string | undefined;
    if (req.systemPrompt) {
      const tk = est(req.systemPrompt);
      used += tk;
      systemContent = req.systemPrompt;
      provenance.push({ kind: 'system', ref: 'system', tokens: tk });
    }

    // 2) consulta (obrigatória)
    const qTk = est(req.query);
    used += qTk;
    provenance.push({ kind: 'query', ref: 'query', tokens: qTk });

    // 3) tools relevantes
    let candidateTools = req.tools ?? [];
    const k = req.maxTools ?? 5;
    if (req.toolSearch) candidateTools = req.toolSearch.find(req.query, k, req.tools);
    else candidateTools = candidateTools.slice(0, k);

    const tools: ToolDescriptor[] = [];
    for (const t of candidateTools) {
      const tk = est(`${t.name} ${t.description}`);
      if (fits(tk)) {
        used += tk;
        tools.push(t);
        provenance.push({ kind: 'tool', ref: t.name, tokens: tk });
      } else {
        dropped++;
      }
    }

    // 4) histórico recente (mais novo primeiro; reordena cronológico no fim)
    const history = req.history ?? [];
    const keptIdx: number[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const tk = est(history[i].content);
      if (fits(tk)) {
        used += tk;
        keptIdx.push(i);
        provenance.push({ kind: 'history', ref: `h${i}`, tokens: tk });
      } else {
        dropped++;
      }
    }
    keptIdx.sort((a, b) => a - b);
    const selectedHistory = keptIdx.map((i) => history[i]);

    // 5) memória (melhor primeiro)
    const memory = req.memory ?? [];
    const selectedMemory: MemoryChunk[] = [];
    for (const m of memory) {
      const tk = est(m.text);
      if (fits(tk)) {
        used += tk;
        selectedMemory.push(m);
        provenance.push({ kind: 'memory', ref: m.source ?? 'mem', tokens: tk });
      } else {
        dropped++;
      }
    }

    // Montagem: system → histórico → bloco de memória → consulta (por último)
    const messages: HistoryMessage[] = [];
    if (systemContent) messages.push({ role: 'system', content: systemContent });
    messages.push(...selectedHistory);
    if (selectedMemory.length > 0) {
      messages.push({
        role: 'system',
        content: `<Context>\n${selectedMemory.map((m) => m.text).join('\n---\n')}\n</Context>`,
      });
    }
    messages.push({ role: 'user', content: req.query });

    return { messages, tools, tokensUsed: used, provenance, selectedMemory, dropped };
  }
}
