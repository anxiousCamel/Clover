/**
 * @clover/tui — Kit de UI de terminal do CloverOS (lógica pura e testável).
 *
 * Tema centralizado (🍀) + parsing de input + modelos interativos (raw-key →
 * escolha, painel multi-tarefa). O acoplamento ao terminal real (raw mode,
 * loop de render) vive em `apps/cli`; aqui fica só a lógica, com testes.
 */

export * from './theme.js';
export * from './input.js';
export * from './interactive.js';
