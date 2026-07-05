/**
 * Testes de regressão para a tool `list_available_tools`.
 *
 * Cobre: catálogo populado, saída estruturada, e o cenário do incidente
 * "quais ferramentas vc possui?" que antes retornava só `respond`.
 */

import { describe, expect, it } from 'vitest';

import { LexicalToolSearch } from '@clover/tool-search';

import { cloverTools, listAvailableToolsTool } from '../src/index.js';
import { setCatalog } from '../src/sys/list-tools.js';

const descriptors = cloverTools.map((t) => t.descriptor);
const search = new LexicalToolSearch(descriptors);

describe('list_available_tools — regressão do incidente "quais ferramentas"', () => {
  it('tool registrada no cloverTools', () => {
    const names = cloverTools.map((t) => t.descriptor.name);
    expect(names).toContain('list_available_tools');
  });

  it('tool tem descrição que captura perguntas sobre capacidades', () => {
    const d = descriptors.find((t) => t.name === 'list_available_tools')!;
    expect(d.description.toLowerCase()).toContain('quais ferramentas');
    expect(d.description.toLowerCase()).toContain('capacidades');
    expect(d.description.toLowerCase()).toContain('sabe fazer');
  });

  it('query "quais ferramentas vc possui" → list_available_tools no top-3', () => {
    const top = search.find('quais ferramentas vc possui', 8).map((t) => t.name);
    expect(top).toContain('list_available_tools');
  });

  it('query "o que você sabe fazer" → list_available_tools no top-3', () => {
    const top = search.find('o que você sabe fazer', 8).map((t) => t.name);
    expect(top).toContain('list_available_tools');
  });

  it('query "help" → list_available_tools no top-3', () => {
    const top = search.find('help', 8).map((t) => t.name);
    expect(top).toContain('list_available_tools');
  });

  it('setCatalog + handler retorna catálogo completo', async () => {
    setCatalog(descriptors);
    const result = await listAvailableToolsTool.handler({}, {
      taskId: 't', traceId: 'tr', workspacePath: '/tmp',
      token: { id: 'k', taskId: 't', caps: [{ kind: 'fs.read' }], issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sig: 't' },
      emit: () => {},
    });
    expect(result.success).toBe(true);
    const out = result.output as { tools: Array<{ name: string }>; total: number };
    expect(out.total).toBeGreaterThan(0);
    expect(out.tools.length).toBe(out.total);
    expect(out.tools.some((t) => t.name === 'list_available_tools')).toBe(true);
    expect(out.tools.some((t) => t.name === 'list_files')).toBe(true);
    expect(out.tools.some((t) => t.name === 'git_status')).toBe(true);
  });
});