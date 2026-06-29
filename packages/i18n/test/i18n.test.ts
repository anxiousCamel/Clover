import { describe, expect, it } from 'vitest';

import { I18n, LANGUAGES, createI18n } from '@clover/i18n';

describe('I18n', () => {
  it('translates by active language', () => {
    const pt = createI18n('pt-BR');
    const en = createI18n('en');
    expect(pt.t('help.title')).toBe('Comandos do REPL');
    expect(en.t('help.title')).toBe('REPL commands');
  });

  it('interpolates variables', () => {
    const pt = createI18n('pt-BR');
    expect(pt.t('model.switched', { name: 'llama3' })).toBe('Modelo ativo agora: llama3');
    expect(createI18n('en').t('status.kernel', { n: 7 })).toBe('Kernel: 7 registered tools');
  });

  it('switches language at runtime', () => {
    const i = new I18n('pt-BR');
    expect(i.t('repl.bye')).toBe('Até logo');
    i.setLang('en');
    expect(i.lang).toBe('en');
    expect(i.t('repl.bye')).toBe('Goodbye');
  });

  it('falls back to EN then to the key for unknown entries', () => {
    const pt = createI18n('pt-BR');
    expect(pt.t('totally.unknown.key')).toBe('totally.unknown.key');
  });

  it('keeps PT-BR strings identical to the legacy CLI (no test breakage)', () => {
    const pt = createI18n('pt-BR');
    expect(pt.t('status.title')).toBe('Status do CloverOS');
    expect(pt.t('repl.unknown', { name: 'x' })).toBe('Comando desconhecido: /x. Use /help.');
    expect(LANGUAGES).toEqual(['en', 'pt-BR']);
  });
});
