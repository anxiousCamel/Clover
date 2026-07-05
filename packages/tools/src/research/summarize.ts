/**
 * research/summarize — Sumarização EXTRATIVA e determinística de documentação
 * (SRP: só análise estrutural de texto/markdown; puro).
 *
 * HONESTO: não é resumo por LLM — é extração de estrutura (árvore de headings,
 * primeiro parágrafo por seção, contagens). Objeto tipado, mesmo input → mesmo
 * output. Resumo em prosa é papel do Planner/LLM em cima disto.
 */

export interface Heading {
  level: number;
  text: string;
  line: number;
}

export interface SectionSummary {
  heading: string;
  level: number;
  firstParagraph: string;
}

export interface DocSummary {
  headings: Heading[];
  sections: SectionSummary[];
  wordCount: number;
  codeBlockCount: number;
  linkCount: number;
}

const FIRST_PARA_MAX = 400;

/** Headings markdown (`#`..`######`) com linha 1-based. */
export function extractHeadings(markdown: string): Heading[] {
  const out: Heading[] = [];
  const lines = markdown.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) out.push({ level: m[1]!.length, text: m[2]!, line: i + 1 });
  }
  return out;
}

/** Resumo estrutural de um documento markdown (ou texto plano). */
export function summarizeDocument(markdown: string): DocSummary {
  const headings = extractHeadings(markdown);
  const lines = markdown.split('\n');

  const firstParagraphAfter = (startLine: number, endLine: number): string => {
    const para: string[] = [];
    let inFence = false;
    for (let i = startLine; i < Math.min(endLine, lines.length); i++) {
      const l = lines[i]!.trim();
      if (/^```/.test(l)) { inFence = !inFence; continue; }
      if (inFence || l.startsWith('#')) continue;
      if (l.length === 0) {
        if (para.length > 0) break;
        continue;
      }
      para.push(l);
    }
    const joined = para.join(' ');
    return joined.length > FIRST_PARA_MAX ? `${joined.slice(0, FIRST_PARA_MAX)}…` : joined;
  };

  const sections: SectionSummary[] = headings.map((h, idx) => ({
    heading: h.text,
    level: h.level,
    firstParagraph: firstParagraphAfter(h.line, headings[idx + 1]?.line ?? lines.length),
  }));

  // Documento sem headings: um pseudo-section com o primeiro parágrafo.
  if (sections.length === 0) {
    const fp = firstParagraphAfter(0, lines.length);
    if (fp) sections.push({ heading: '(documento)', level: 0, firstParagraph: fp });
  }

  const codeBlockCount = (markdown.match(/^```/gm) ?? []).length >> 1;
  const linkCount = (markdown.match(/\[[^\]]*\]\([^)]+\)|https?:\/\/\S+/g) ?? []).length;
  const wordCount = markdown.split(/\s+/).filter((w) => w.length > 0).length;

  return { headings, sections, wordCount, codeBlockCount, linkCount };
}
