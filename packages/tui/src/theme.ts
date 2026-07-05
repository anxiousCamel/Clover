/**
 * Tema centralizado do CloverOS (🍀). TODAS as cores/símbolos vivem aqui — nada
 * de códigos ANSI espalhados pelo repo. Inclui fallback limpo: sem cor (NO_COLOR
 * / não-TTY) e sem unicode (terminal não-UTF-8), para evitar lixo visual.
 */

export interface ThemeCaps {
  color: boolean;
  unicode: boolean;
}

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  brightGreen: '\x1b[92m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

export interface SymbolSet {
  clover: string;
  ok: string;
  fail: string;
  pending: string;
  bullet: string;
  pointer: string;
  spinner: string[];
}

const UNICODE_SYMBOLS: SymbolSet = {
  clover: '🍀',
  ok: '🟢',
  fail: '🔴',
  pending: '⚪',
  bullet: '•',
  pointer: '❯',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

const ASCII_SYMBOLS: SymbolSet = {
  clover: '*',
  ok: '[ok]',
  fail: '[x]',
  pending: '[ ]',
  bullet: '-',
  pointer: '>',
  spinner: ['|', '/', '-', '\\'],
};

/** Detecta capacidades a partir do ambiente e do stream de saída. */
export function detectCaps(
  env: NodeJS.ProcessEnv = process.env,
  stream: { isTTY?: boolean } = process.stdout,
): ThemeCaps {
  const color = Boolean(stream?.isTTY) && !env.NO_COLOR && env.TERM !== 'dumb';
  const locale = `${env.LC_ALL ?? ''}${env.LC_CTYPE ?? ''}${env.LANG ?? ''}`;
  const unicode =
    !env.CLOVER_ASCII &&
    (/utf-?8/i.test(locale) || process.platform === 'darwin' || process.platform === 'win32');
  return { color, unicode };
}

/**
 * BLINDAGEM (SRE): todos os formatadores são arrow-properties **bound à
 * instância** — podem ser destacados (`const f = theme.warn`) e passados como
 * callback sem perder o `this` (bug real: "Cannot read properties of undefined
 * (reading 'paint')"). Entrada também é nil-safe: `undefined`/objeto vira
 * string ao invés de explodir no template.
 */
export class ThemeManager {
  readonly symbols: SymbolSet;

  constructor(readonly caps: ThemeCaps) {
    this.symbols = caps.unicode ? UNICODE_SYMBOLS : ASCII_SYMBOLS;
  }

  private paint(code: string, s: unknown): string {
    const text = typeof s === 'string' ? s : s == null ? '' : String(s);
    return this.caps.color ? `${code}${text}${ANSI.reset}` : text;
  }

  success = (s: unknown): string => this.paint(ANSI.brightGreen, s);
  error = (s: unknown): string => this.paint(ANSI.red, s);
  warn = (s: unknown): string => this.paint(ANSI.yellow, s);
  info = (s: unknown): string => this.paint(ANSI.cyan, s);
  dim = (s: unknown): string => this.paint(ANSI.dim, s);
  accent = (s: unknown): string => this.paint(ANSI.green, s);
  heading = (s: unknown): string => this.paint(`${ANSI.bold}${ANSI.brightGreen}`, s);

  /** Cabeçalho do CloverOS com o trevo. */
  banner = (text: string): string => this.heading(`${this.symbols.clover} ${text}`);

  /** Símbolo de estado colorido. */
  statusIcon = (state: 'ok' | 'fail' | 'pending'): string => {
    if (state === 'ok') return this.success(this.symbols.ok);
    if (state === 'fail') return this.error(this.symbols.fail);
    return this.dim(this.symbols.pending);
  };
}

/** Cria um ThemeManager com auto-detecção (ou caps explícitas para testes). */
export function createTheme(caps?: Partial<ThemeCaps>): ThemeManager {
  const detected = detectCaps();
  return new ThemeManager({ ...detected, ...caps });
}
