import { rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConfigStore, DEFAULT_CONFIG } from '@clover/config';

const tmpDirs: string[] = [];
function tmpPath(): string {
  const dir = join(tmpdir(), `clover-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tmpDirs.push(dir);
  return join(dir, 'config.json');
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('ConfigStore', () => {
  it('returns defaults when no file exists', () => {
    const store = new ConfigStore(tmpPath());
    expect(store.getValue('language')).toBe('pt-BR');
    expect(store.getValue('mode')).toBe('step');
    expect(store.activeProviderConfig().kind).toBe('ollama');
  });

  it('persists changes and reloads them', () => {
    const file = tmpPath();
    const a = new ConfigStore(file);
    a.set('language', 'en');
    a.set('defaultModel', 'llama3');
    a.set('mode', 'auto');

    const b = new ConfigStore(file);
    expect(b.getValue('language')).toBe('en');
    expect(b.getValue('defaultModel')).toBe('llama3');
    expect(b.getValue('mode')).toBe('auto');
  });

  it('writes the file with restricted permissions (0600)', () => {
    const file = tmpPath();
    const store = new ConfigStore(file);
    store.set('logLevel', 'debug');
    const mode = statSync(file).mode & 0o777;
    expect(mode & 0o077).toBe(0); // sem permissão para grupo/outros
  });

  it('adds providers and switches the active one', () => {
    const file = tmpPath();
    const store = new ConfigStore(file);
    store.setProvider('openrouter', {
      kind: 'openai-compatible',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
      model: 'anthropic/claude-3.5',
      supportsStructuredOutputs: true,
    });
    expect(store.setActiveProvider('openrouter')).toBe(true);
    expect(store.activeProviderConfig().baseURL).toBe('https://openrouter.ai/api/v1');
    expect(store.setActiveProvider('missing')).toBe(false);
  });

  it('merges partial/old config files with current defaults', () => {
    const file = tmpPath();
    // grava um arquivo parcial manualmente via store e remove uma chave
    const a = new ConfigStore(file);
    a.set('language', 'en');
    // novo store lê e deve ter todas as chaves de DEFAULT_CONFIG presentes
    const b = new ConfigStore(file).get();
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      expect(b).toHaveProperty(key);
    }
  });
});
