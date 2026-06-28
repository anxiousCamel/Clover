/**
 * Processamento de input do REPL: comandos de barra, interceptação de
 * arquivos/imagens (tags limpas em vez de strings cruas) e contadores de tokens.
 */

// --- Comandos de barra ------------------------------------------------------

export interface SlashCommand {
  name: string;
  args: string[];
  raw: string;
}

export const KNOWN_COMMANDS = ['help', 'model', 'status', 'clear', 'exit'] as const;
export type KnownCommand = (typeof KNOWN_COMMANDS)[number];

export function parseSlash(input: string): SlashCommand | null {
  const t = input.trim();
  if (!t.startsWith('/')) return null;
  const parts = t.slice(1).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return { name: parts[0].toLowerCase(), args: parts.slice(1), raw: t };
}

export function isKnownCommand(name: string): name is KnownCommand {
  return (KNOWN_COMMANDS as readonly string[]).includes(name);
}

// --- Interceptação de arquivos/imagens -------------------------------------

export type AttachmentKind = 'image' | 'file';

export interface DetectedAttachment {
  kind: AttachmentKind;
  path: string;
}

export interface ProcessedInput {
  /** Texto com caminhos substituídos por tags limpas. */
  text: string;
  attachments: DetectedAttachment[];
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|tiff?)$/i;
const HAS_EXT = /\.[A-Za-z0-9]{1,8}$/;
const HAS_SEP = /[/\\]/;

function classify(value: string): AttachmentKind {
  return IMAGE_EXT.test(value) ? 'image' : 'file';
}

/**
 * Decide se um token é um caminho de arquivo/imagem. Regra conservadora para
 * evitar falsos positivos (ex.: "node.js"): aceita se for **quoted**, ou tiver
 * **separador de caminho**, ou terminar com **extensão de imagem**.
 */
function looksLikePath(value: string, quoted: boolean): boolean {
  if (IMAGE_EXT.test(value)) return true;
  if (quoted && HAS_EXT.test(value)) return true;
  if (HAS_SEP.test(value) && HAS_EXT.test(value)) return true;
  return false;
}

/** Tokeniza preservando segmentos entre aspas (drag-drop costuma citar paths). */
function tokenize(input: string): Array<{ value: string; quoted: boolean }> {
  const tokens: Array<{ value: string; quoted: boolean }> = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = input.indexOf(ch, i + 1);
      if (end !== -1) {
        tokens.push({ value: input.slice(i + 1, end), quoted: true });
        i = end + 1;
        continue;
      }
    }
    let j = i;
    while (j < input.length && input[j] !== ' ' && input[j] !== '\t') j++;
    tokens.push({ value: input.slice(i, j), quoted: false });
    i = j;
  }
  return tokens;
}

export function tagFor(att: DetectedAttachment): string {
  return att.kind === 'image' ? `[imagem: ${att.path}]` : `[arquivo: ${att.path}]`;
}

/**
 * Substitui caminhos por tags limpas (`[imagem: ...]` / `[arquivo: ...]`) e
 * coleta os anexos. Texto sem caminhos passa inalterado.
 */
export function processInput(raw: string): ProcessedInput {
  const attachments: DetectedAttachment[] = [];
  const out = tokenize(raw).map(({ value, quoted }) => {
    if (looksLikePath(value, quoted)) {
      const att: DetectedAttachment = { kind: classify(value), path: value };
      attachments.push(att);
      return tagFor(att);
    }
    return value;
  });
  return { text: out.join(' '), attachments };
}

// --- Contador de tokens -----------------------------------------------------

export interface TokenUsage {
  input: number;
  output: number;
}

export function formatUsage(u: TokenUsage): string {
  return `Tokens consumidos: Input: ${u.input} | Output: ${u.output}`;
}

export class UsageCounter {
  private state: TokenUsage = { input: 0, output: 0 };

  addInput(n: number): void {
    this.state.input += Math.max(0, n);
  }
  addOutput(n: number): void {
    this.state.output += Math.max(0, n);
  }
  reset(): void {
    this.state = { input: 0, output: 0 };
  }
  get usage(): TokenUsage {
    return { ...this.state };
  }
  format(): string {
    return formatUsage(this.state);
  }
}
