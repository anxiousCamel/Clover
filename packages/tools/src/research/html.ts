/**
 * research/html — Conversão HTML → texto legível (SRP: só parsing; puro).
 *
 * Implementação real por regex estruturada (sem dependência de DOM): remove
 * script/style/nav/etc., preserva quebras de bloco, decodifica entidades
 * comuns, colapsa whitespace. Suficiente para páginas de documentação; não é
 * um browser — declarado.
 */

const BLOCK_TAGS = /<\/(p|div|section|article|li|ul|ol|table|tr|h[1-6]|pre|blockquote|br)[^>]*>|<(br|hr)\s*\/?>/gi;
const DROP_BLOCKS = /<(script|style|noscript|svg|nav|footer|iframe|head)[\s\S]*?<\/\1>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const TAGS = /<[^>]+>/g;

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&copy;': '©',
};

/** Entidades de letra acentuada Latin-1 (&aacute; &Ntilde; &ccedil; ...). */
const ACCENTS: Record<string, string> = {
  acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈', cedil: '̧',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&([a-zA-Z])(acute|grave|circ|tilde|uml|cedil);/g, (_, letter: string, accent: string) =>
      (letter + ACCENTS[accent]).normalize('NFC'),
    )
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
}

/** Título do documento (<title> ou primeiro <h1>), ou ''. */
export function extractTitle(html: string): string {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?? '';
  return decodeEntities(t.replace(TAGS, '')).trim();
}

/** HTML → texto plano legível com quebras de bloco preservadas. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(COMMENTS, '')
      .replace(DROP_BLOCKS, '\n')
      .replace(BLOCK_TAGS, '\n')
      .replace(TAGS, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1]!.length > 0)) // colapsa linhas vazias consecutivas
    .join('\n')
    .trim();
}

/** Heurística simples: corpo parece HTML? */
export function looksLikeHtml(body: string, contentType: string | null): boolean {
  if (contentType?.includes('text/html')) return true;
  return /<html[\s>]|<!doctype html/i.test(body.slice(0, 512));
}
