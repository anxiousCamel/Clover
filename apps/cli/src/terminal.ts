/**
 * Glue de terminal (não unit-testado — requer TTY). Mantém a parte "suja" do
 * raw mode/readline isolada da lógica (ReplEngine/setup/resilience).
 */

import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

import { ChoicePrompt, ThemeManager, decodeKey } from '@clover/tui';

export interface LineReader {
  question(prompt: string): Promise<string>;
  close(): void;
}

export function createLineReader(): LineReader {
  const rl = createInterface({ input: stdin, output: stdout });
  return {
    question: (prompt) => new Promise<string>((resolve) => rl.question(prompt, resolve)),
    close: () => rl.close(),
  };
}

export function render(text: string): void {
  stdout.write(`${text}\n`);
}

export function clearScreen(): void {
  stdout.write('\x1b[2J\x1b[H');
}

/**
 * Lê uma escolha em **raw mode**: a tecla NÃO ecoa/vaza na tela; a UI é
 * redesenhada a cada tecla e só o resultado final permanece.
 */
export async function promptChoice(
  prompt: ChoicePrompt,
  theme: ThemeManager,
): Promise<{ value?: string; cancelled?: boolean }> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    // Sem TTY: não dá para capturar teclas com segurança → cancela.
    render(prompt.render(theme));
    render(theme.warn('Sem TTY interativo: ação cancelada por segurança.'));
    return { cancelled: true };
  }
  return new Promise((resolve) => {
    const draw = (): void => {
      clearScreen();
      stdout.write(`${prompt.render(theme)}\n`);
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    draw();
    const onData = (seq: string): void => {
      const result = prompt.handle(decodeKey(seq));
      if (!result.done) {
        draw();
        return;
      }
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      resolve({ value: result.value, cancelled: result.cancelled });
    };
    stdin.on('data', onData);
  });
}

/**
 * Spinner de linha única (anti-freeze) com rótulo dinâmico de "raciocínio vivo".
 * `label()` é reavaliado a cada frame (pode refletir fase atual + atores ativos).
 */
export async function withSpinner<T>(
  label: () => string,
  theme: ThemeManager,
  task: () => Promise<T>,
): Promise<T> {
  if (!stdout.isTTY) return task();
  const frames = theme.symbols.spinner;
  let i = 0;
  const timer = setInterval(() => {
    stdout.write(`\r${theme.accent(frames[i++ % frames.length])} ${label()}\x1b[K`);
  }, 90);
  try {
    return await task();
  } finally {
    clearInterval(timer);
    stdout.write('\r\x1b[K'); // limpa a linha do spinner
  }
}
