/**
 * @clover/knowledge-retriever — Recuperação estrutural (RAP §8.3, §9; Fase 4).
 *
 * Em vez de despejar arquivos crus no LLM, recupera **snippets estruturais
 * compactos** (símbolo, tipo, export, localização + membros via KG) relevantes
 * para a consulta. A saída alimenta o Context Builder, que aplica o orçamento de
 * tokens antes do planejamento.
 */

import type { AstIndex, AstSymbol } from '@clover/ast-index';
import type { KnowledgeGraph } from '@clover/knowledge-graph';

export interface KnowledgeSnippet {
  text: string;
  source: string;
  score: number;
}

export interface RetrieveOptions {
  topK?: number;
}

export function tokenizeQuery(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export class KnowledgeRetriever {
  constructor(
    private readonly index: AstIndex,
    private readonly graph?: KnowledgeGraph,
  ) {}

  retrieve(query: string, opts: RetrieveOptions = {}): KnowledgeSnippet[] {
    const terms = tokenizeQuery(query);
    if (terms.length === 0) return [];
    return this.index
      .allSymbols()
      .map((sym) => ({ sym, score: scoreSymbol(terms, sym) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.sym.name.localeCompare(b.sym.name))
      .slice(0, opts.topK ?? 5)
      .map(({ sym, score }) => ({
        text: renderSnippet(sym, this.graph),
        source: `${sym.filePath}:${sym.line}`,
        score,
      }));
  }
}

function scoreSymbol(terms: string[], sym: AstSymbol): number {
  const hay = new Set(tokenizeQuery(`${sym.name} ${sym.container ?? ''} ${sym.kind}`));
  const nameSet = new Set(tokenizeQuery(sym.name));
  let score = 0;
  for (const t of terms) {
    if (hay.has(t)) score += 1;
    if (nameSet.has(t)) score += 1; // casar no nome vale mais
  }
  if (score > 0 && sym.exported) score += 0.5; // leve preferência por API pública
  return score;
}

function symbolId(sym: AstSymbol): string {
  const prefix = sym.container ? `${sym.container}.` : '';
  return `sym:${sym.filePath}#${prefix}${sym.name}`;
}

function renderSnippet(sym: AstSymbol, graph?: KnowledgeGraph): string {
  const prefix = sym.container ? `${sym.container}.` : '';
  let text = `${sym.kind} ${prefix}${sym.name}${sym.exported ? ' (exported)' : ''} @ ${sym.filePath}:${sym.line}`;
  if (graph) {
    const members = graph.neighbors(symbolId(sym), { rel: 'has-member' });
    if (members.length > 0) {
      text += ` | members: ${members.map((m) => String(m.props?.name ?? '')).join(', ')}`;
    }
  }
  return text;
}
