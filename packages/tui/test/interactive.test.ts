import { describe, expect, it } from 'vitest';

import { ChoicePrompt, StatusBoard, ThemeManager, decodeKey } from '@clover/tui';

const ESC = '\x1b';

describe('decodeKey', () => {
  it('decodes arrows, enter, cancel and digits from raw sequences', () => {
    expect(decodeKey(`${ESC}[A`)).toBe('up');
    expect(decodeKey(`${ESC}[B`)).toBe('down');
    expect(decodeKey('\r')).toBe('enter');
    expect(decodeKey('\x03')).toBe('cancel'); // Ctrl-C
    expect(decodeKey(ESC)).toBe('cancel'); // Esc
    expect(decodeKey('3')).toEqual({ digit: 3 });
    expect(decodeKey('x')).toBe('other');
  });
});

describe('ChoicePrompt (no input leak: state reacts to keys)', () => {
  const choices = [
    { label: 'Sim', value: 'yes' },
    { label: 'Não', value: 'no' },
    { label: 'Sempre', value: 'always' },
  ];

  it('navigates with arrows and wraps around', () => {
    const p = new ChoicePrompt('Confirma?', choices);
    expect(p.index).toBe(0);
    p.handle('down');
    expect(p.index).toBe(1);
    p.handle('up');
    p.handle('up'); // wrap: 0 -> 2
    expect(p.index).toBe(2);
  });

  it('confirms with enter and selects directly by digit', () => {
    const p = new ChoicePrompt('Confirma?', choices);
    p.handle('down'); // index 1
    expect(p.handle('enter')).toEqual({ done: true, value: 'no' });

    const p2 = new ChoicePrompt('Confirma?', choices);
    expect(p2.handle({ digit: 3 })).toEqual({ done: true, value: 'always' });
  });

  it('cancels with Esc/Ctrl-C', () => {
    const p = new ChoicePrompt('Confirma?', choices);
    expect(p.handle('cancel')).toEqual({ done: true, cancelled: true });
  });

  it('renders the selected option distinctly', () => {
    const theme = new ThemeManager({ color: false, unicode: false });
    const p = new ChoicePrompt('Rodar comando destrutivo?', choices);
    const out = p.render(theme);
    expect(out).toContain('Rodar comando destrutivo?');
    expect(out).toContain('1. Sim');
    expect(out).toContain('>'); // ponteiro ASCII na opção ativa
  });
});

describe('StatusBoard (concurrent actors)', () => {
  it('tracks concurrent tasks and renders one line each', () => {
    const theme = new ThemeManager({ color: false, unicode: false });
    const board = new StatusBoard();
    board.add('a', 'Ator A: Buscando dependencias');
    board.add('b', 'Ator B: Analisando AST');
    expect(board.activeCount).toBe(2);

    const running = board.render(theme);
    expect(running.split('\n')).toHaveLength(2);
    expect(running).toContain('Ator A: Buscando dependencias');

    board.update('a', { state: 'done' });
    expect(board.activeCount).toBe(1);
    expect(board.render(theme)).toContain('[ok] Ator A: Buscando dependencias');

    board.update('b', { state: 'failed' });
    expect(board.render(theme)).toContain('[x] Ator B: Analisando AST');
  });

  it('advances spinner frames on tick', () => {
    const theme = new ThemeManager({ color: false, unicode: false });
    const board = new StatusBoard();
    board.add('a', 'work');
    const f0 = board.render(theme);
    board.tick();
    const f1 = board.render(theme);
    expect(f0).not.toBe(f1); // frame mudou
  });
});
