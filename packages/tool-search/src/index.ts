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

/** Pontua um descritor contra os termos da consulta. */
export function scoreTool(queryTerms: string[], tool: ToolDescriptor): number {
  const haystack = new Set(tokenize(`${tool.name} ${tool.description}`));
  const nameTerms = new Set(tokenize(tool.name));
  let score = 0;
  for (const term of queryTerms) {
    if (haystack.has(term)) score += 1;
    if (nameTerms.has(term)) score += 1; // bônus: casar no nome vale mais
  }
  return score;
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
