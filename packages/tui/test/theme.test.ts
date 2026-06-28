import { describe, expect, it } from 'vitest';

import { ThemeManager, detectCaps } from '@clover/tui';

describe('ThemeManager', () => {
  it('applies ANSI color only when color is enabled', () => {
    const colored = new ThemeManager({ color: true, unicode: true });
    const plain = new ThemeManager({ color: false, unicode: true });
    expect(colored.success('ok')).toContain('\x1b[');
    expect(plain.success('ok')).toBe('ok'); // fallback sem cor → texto puro
  });

  it('falls back to ASCII symbols when unicode is unavailable', () => {
    const uni = new ThemeManager({ color: false, unicode: true });
    const ascii = new ThemeManager({ color: false, unicode: false });
    expect(uni.symbols.clover).toBe('🍀');
    expect(ascii.symbols.clover).toBe('*');
    expect(ascii.symbols.ok).toBe('[ok]');
  });

  it('detectCaps disables color for non-TTY or NO_COLOR', () => {
    expect(detectCaps({}, { isTTY: false }).color).toBe(false);
    expect(detectCaps({ NO_COLOR: '1' }, { isTTY: true }).color).toBe(false);
    expect(detectCaps({ TERM: 'xterm' }, { isTTY: true }).color).toBe(true);
  });

  it('detectCaps honors CLOVER_ASCII to force ASCII', () => {
    expect(detectCaps({ LANG: 'en_US.UTF-8', CLOVER_ASCII: '1' }, { isTTY: true }).unicode).toBe(false);
    expect(detectCaps({ LANG: 'en_US.UTF-8' }, { isTTY: true }).unicode).toBe(true);
  });
});
