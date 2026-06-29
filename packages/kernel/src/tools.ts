/**
 * Tools de demonstração para o walking skeleton. Puras e sem efeitos colaterais
 * — exercitam a Tool ABI, a resolução de bindings (IRRef) e o gate de
 * capability sem precisar de sandbox/FS.
 */

import { defineTool, type LocalTool } from '@clover/tool-abi';

/** echo: retorna o texto recebido como { text }. */
export const echoTool: LocalTool = defineTool(
  {
    name: 'echo',
    description: 'Retorna o texto recebido.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    capabilities: [],
    pure: true,
  },
  (args) => ({ success: true, output: { text: String(args.text ?? '') } }),
);

/** concat: concatena a + b e retorna { text }. */
export const concatTool: LocalTool = defineTool(
  {
    name: 'concat',
    description: 'Concatena dois textos (a + b).',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['a', 'b'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    capabilities: [],
    pure: true,
  },
  (args) => ({ success: true, output: { text: `${String(args.a ?? '')}${String(args.b ?? '')}` } }),
);

/** Conjunto de tools demo. */
export const demoTools: LocalTool[] = [echoTool, concatTool];
