/**
 * @clover/config — Configuração global do usuário (Escopo Produto/UX).
 *
 * Persistida em `~/.cloveros/config.json` (FORA da pasta do projeto) com
 * permissões restritas (dir 0700, arquivo 0600) — credenciais de provedor não
 * vazam. O Agent/Context Builder leem isto dinamicamente. Caminho injetável
 * para testes.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type Language = 'en' | 'pt-BR';
export type LogLevel = 'silent' | 'info' | 'debug';
export type AgentMode = 'step' | 'auto';
export type ProviderKind = 'ollama' | 'openai-compatible';

export interface ProviderConfig {
  kind: ProviderKind;
  baseURL?: string;
  /** Chave de API (apenas para provedores de nuvem). */
  apiKey?: string;
  model?: string;
  /** O provedor suporta structured outputs (json_schema)? */
  supportsStructuredOutputs?: boolean;
}

export interface CloverConfig {
  language: Language;
  defaultModel: string;
  logLevel: LogLevel;
  mode: AgentMode;
  activeProvider: string;
  providers: Record<string, ProviderConfig>;
}

export const DEFAULT_CONFIG: CloverConfig = {
  language: 'pt-BR',
  defaultModel: 'qwen2.5-coder',
  logLevel: 'info',
  mode: 'step',
  activeProvider: 'ollama',
  providers: {
    ollama: { kind: 'ollama', baseURL: 'http://localhost:11434', model: 'qwen2.5-coder' },
  },
};

export function defaultConfigPath(): string {
  return join(homedir(), '.cloveros', 'config.json');
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function merge(raw: Partial<CloverConfig>): CloverConfig {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    providers: { ...DEFAULT_CONFIG.providers, ...(raw.providers ?? {}) },
  };
}

export class ConfigStore {
  private config: CloverConfig;

  constructor(private readonly filePath: string = defaultConfigPath()) {
    this.config = this.read();
  }

  private read(): CloverConfig {
    try {
      if (existsSync(this.filePath)) {
        return merge(JSON.parse(readFileSync(this.filePath, 'utf8').replace(/^﻿/, '')) as Partial<CloverConfig>);
      }
    } catch {
      /* config corrompida → usa defaults */
    }
    return clone(DEFAULT_CONFIG);
  }

  get(): CloverConfig {
    return clone(this.config);
  }

  getValue<K extends keyof CloverConfig>(key: K): CloverConfig[K] {
    return clone(this.config[key]);
  }

  set<K extends keyof CloverConfig>(key: K, value: CloverConfig[K]): void {
    this.config[key] = value;
    this.save();
  }

  setProvider(name: string, provider: ProviderConfig): void {
    this.config.providers[name] = provider;
    this.save();
  }

  setActiveProvider(name: string): boolean {
    if (!this.config.providers[name]) return false;
    this.config.activeProvider = name;
    this.save();
    return true;
  }

  /** Config do provedor ativo (com fallback para ollama). */
  activeProviderConfig(): ProviderConfig {
    return this.config.providers[this.config.activeProvider] ?? DEFAULT_CONFIG.providers.ollama;
  }

  path(): string {
    return this.filePath;
  }

  save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    writeFileSync(this.filePath, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    // Garante 0600 mesmo se o arquivo já existia com outra máscara.
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      /* best-effort em plataformas sem chmod POSIX */
    }
  }
}
