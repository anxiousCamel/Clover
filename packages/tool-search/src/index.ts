/**
 * @clover/tool-search — Descoberta de ferramentas (RAP §11.12).
 *
 * Com milhares de tools, NÃO se coloca todas no contexto. Recupera-se as
 * relevantes por similaridade com a consulta. Esta fatia usa um scorer
 * **lexical determinístico** (overlap de termos, bônus para casamento no nome),
 * atrás da interface `ToolSearch` — um scorer por embeddings entra depois sem
 * mudar o contrato. Espelha o `ToolSearch` de harnesses modernos.
 */

import type { ToolDescriptor } from '@clover/contracts';

export interface ToolSearch {
  /** Top-k tools mais relevantes para a consulta. */
  find(query: string, k: number, tools?: ToolDescriptor[]): ToolDescriptor[];
}

export function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Peso por intent (menor privilégio na SELEÇÃO): tools destrutivas/de escrita
 * precisam de evidência lexical MAIS FORTE para entrar no contexto do Planner.
 * Incidente real: "listar os arquivos da area de trabalho" selecionou
 * `git_clean` (destructive) por overlap acidental de termos — com o peso, uma
 * tool `read` equivalente sempre vence o empate.
 */
const INTENT_WEIGHT: Record<string, number> = { read: 1, write: 0.75, destructive: 0.5 };

/**
 * Stopwords (PT + EN) sem valor discriminativo. Removidas SÓ dos termos da
 * consulta na pontuação — senão "listar os arquivos DA área DE trabalho" pontua
 * tools por casar `de`/`da`/`os`, afogando o sinal real (`listar`, `arquivos`).
 */
const STOPWORDS = new Set([
  'o', 'a', 'os', 'as', 'de', 'da', 'do', 'das', 'dos', 'e', 'ou', 'um', 'uma',
  'para', 'por', 'com', 'no', 'na', 'nos', 'nas', 'que', 'em', 'ao', 'aos',
  'consegue', 'me', 'meu', 'minha', 'the', 'a', 'an', 'of', 'to', 'in', 'on',
  'for', 'and', 'or', 'is', 'my', 'can', 'you', 'please',
]);

/** Pontua um descritor contra os termos da consulta (ponderado por intent). */
export function scoreTool(queryTerms: string[], tool: ToolDescriptor): number {
  const haystack = new Set(tokenize(`${tool.name} ${tool.description}`));
  const nameTerms = new Set(tokenize(tool.name));
  let score = 0;
  for (const term of queryTerms) {
    if (STOPWORDS.has(term)) continue;
    if (haystack.has(term)) score += 1;
    if (nameTerms.has(term)) score += 1; // bônus: casar no nome vale mais
  }
  return score * (INTENT_WEIGHT[tool.intent ?? 'read'] ?? 1);
}

/** Implementação lexical (sem embeddings; determinística e offline). */
export class LexicalToolSearch implements ToolSearch {
  constructor(private readonly catalog: ToolDescriptor[] = []) {}

  find(query: string, k: number, tools: ToolDescriptor[] = this.catalog): ToolDescriptor[] {
    const terms = tokenize(query);
    if (terms.length === 0 || k <= 0) return [];
    return tools
      .map((t) => ({ t, s: scoreTool(terms, t) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.t.name.localeCompare(b.t.name))
      .slice(0, k)
      .map((x) => x.t);
  }
}
