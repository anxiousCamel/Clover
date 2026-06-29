/**
 * Tool Search — recupera as tools relevantes sem inundar o contexto.
 */

import { describe, expect, it } from 'vitest';

import type { ToolDescriptor } from '@clover/contracts';
import { LexicalToolSearch } from '@clover/tool-search';

const tool = (name: string, description: string): ToolDescriptor => ({
  name,
  description,
  inputSchema: {},
  capabilities: [],
  origin: 'local',
});

const catalog: ToolDescriptor[] = [
  tool('read-file', 'Lê o conteúdo de um arquivo do disco'),
  tool('write-file', 'Escreve conteúdo em um arquivo'),
  tool('http-get', 'Faz uma requisição HTTP GET a uma URL'),
  tool('search-web', 'Pesquisa na web por um termo'),
  tool('list-files', 'Lista arquivos de um diretório'),
];

describe('LexicalToolSearch', () => {
  it('ranks file-reading tools first for a file-read query', () => {
    const search = new LexicalToolSearch(catalog);
    const results = search.find('ler um arquivo do disco', 3);
    expect(results[0].name).toBe('read-file');
    expect(results.map((t) => t.name)).not.toContain('http-get');
  });

  it('respects the k limit', () => {
    const search = new LexicalToolSearch(catalog);
    expect(search.find('arquivo', 2).length).toBeLessThanOrEqual(2);
  });

  it('returns nothing when no tool matches', () => {
    const search = new LexicalToolSearch(catalog);
    expect(search.find('quantum entanglement', 5)).toEqual([]);
  });

  it('matches on the tool name strongly (http)', () => {
    const search = new LexicalToolSearch(catalog);
    const results = search.find('http get url', 2);
    expect(results[0].name).toBe('http-get');
  });
});
