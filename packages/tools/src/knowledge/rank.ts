/**
 * knowledge/rank — Ranqueamento BM25 (Okapi) REAL e determinístico (SRP: só o
 * algoritmo; sem I/O).
 *
 * HONESTIDADE DE ESCOPO: isto é recuperação **léxica** (BM25 — o algoritmo
 * clássico de search engines), não embeddings neurais. É o que dá para entregar
 * de verdade sem um modelo de embeddings local; a tool `semantic_search`
 * declara isso na descrição. Troca por embeddings entra quando houver modelo
 * disponível, atrás da MESMA interface (`rankDocuments`).
 */

const K1 = 1.2;
const B = 0.75;

/** Tokenização: minúsculas, sem acentos, alfanumérico; termos de 2+ chars. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2);
}

export interface RankedDoc {
  id: string;
  score: number;
}

export interface RankableDoc {
  id: string;
  text: string;
}

/**
 * BM25 sobre o corpus dado. Retorna docs com score > 0, ordenados por score
 * desc (empate: id asc — estável/determinístico), limitados a `topK`.
 */
export function rankDocuments(query: string, docs: RankableDoc[], topK: number): RankedDoc[] {
  const qTerms = [...new Set(tokenize(query))];
  if (qTerms.length === 0 || docs.length === 0) return [];

  const docTokens = docs.map((d) => tokenize(d.text));
  const N = docs.length;
  const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / N || 1;

  // df por termo da query.
  const df = new Map<string, number>();
  for (const term of qTerms) {
    let n = 0;
    for (const tokens of docTokens) if (tokens.includes(term)) n++;
    df.set(term, n);
  }

  const scores: RankedDoc[] = [];
  for (let i = 0; i < N; i++) {
    const tokens = docTokens[i]!;
    const len = tokens.length || 1;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const term of qTerms) {
      const n = df.get(term) ?? 0;
      if (n === 0) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const f = tf.get(term) ?? 0;
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (len / avgLen))));
    }
    if (score > 0) scores.push({ id: docs[i]!.id, score });
  }

  return scores
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, topK);
}
