/**
 * Context Builder — respeita o orçamento de tokens, prioriza e registra
 * proveniência; integra com Tool Search para trazer só tools relevantes.
 */

import { describe, expect, it } from 'vitest';

import type { ToolDescriptor } from '@clover/contracts';
import { LexicalToolSearch } from '@clover/tool-search';
import { ContextBuilder } from '@clover/context-builder';

const tool = (name: string, description: string): ToolDescriptor => ({
  name,
  description,
  inputSchema: {},
  capabilities: [],
  origin: 'local',
});

const tools = [
  tool('read-file', 'lê arquivo do disco'),
  tool('http-get', 'requisição http'),
  tool('list-files', 'lista arquivos do diretório'),
];

describe('ContextBuilder', () => {
  it('never exceeds the token budget and always includes system + query', () => {
    const cb = new ContextBuilder();
    const ctx = cb.build({
      query: 'ler o arquivo de config',
      budget: { maxTokens: 1000 },
      systemPrompt: 'Você é o Clover.',
      history: Array.from({ length: 20 }, (_, i) => ({ role: 'user' as const, content: `mensagem ${i} `.repeat(10) })),
      memory: Array.from({ length: 10 }, (_, i) => ({ text: `fato ${i} `.repeat(20), source: `m${i}` })),
      tools,
      toolSearch: new LexicalToolSearch(),
      maxTools: 2,
    });

    expect(ctx.tokensUsed).toBeLessThanOrEqual(1000);
    expect(ctx.messages[0]).toEqual({ role: 'system', content: 'Você é o Clover.' });
    expect(ctx.messages[ctx.messages.length - 1]).toEqual({ role: 'user', content: 'ler o arquivo de config' });
  });

  it('selects relevant tools via tool search', () => {
    const cb = new ContextBuilder();
    const ctx = cb.build({
      query: 'ler arquivo',
      budget: { maxTokens: 1000 },
      tools,
      toolSearch: new LexicalToolSearch(),
      maxTools: 1,
    });
    expect(ctx.tools.map((t) => t.name)).toEqual(['read-file']);
  });

  it('drops lower-priority items under a tight budget but keeps mandatory ones', () => {
    const cb = new ContextBuilder();
    const ctx = cb.build({
      query: 'q', // pequeno
      budget: { maxTokens: 5 }, // só cabe o essencial
      systemPrompt: 'sys',
      history: [{ role: 'user', content: 'a'.repeat(400) }],
      memory: [{ text: 'b'.repeat(400) }],
      tools,
      maxTools: 3,
    });
    // system + query presentes; histórico/memória/tools descartados.
    expect(ctx.messages.some((m) => m.content === 'sys')).toBe(true);
    expect(ctx.messages[ctx.messages.length - 1].content).toBe('q');
    expect(ctx.dropped).toBeGreaterThan(0);
    expect(ctx.tools).toEqual([]);
  });

  it('records provenance for every included piece', () => {
    const cb = new ContextBuilder();
    const ctx = cb.build({
      query: 'ler arquivo',
      budget: { maxTokens: 1000 },
      systemPrompt: 'sys',
      memory: [{ text: 'um fato', source: 'doc1' }],
      tools,
      toolSearch: new LexicalToolSearch(),
      maxTools: 1,
    });
    const kinds = ctx.provenance.map((p) => p.kind);
    expect(kinds).toContain('system');
    expect(kinds).toContain('query');
    expect(kinds).toContain('tool');
    expect(kinds).toContain('memory');
  });
});
