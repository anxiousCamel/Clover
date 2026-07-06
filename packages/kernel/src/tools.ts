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

/**
 * respond: envia uma resposta em linguagem natural ao usuário.
 * Ferramenta de base que permite ao Planner responder perguntas conversacionais
 * e tarefas que não exigem execução de código ou acesso a arquivos.
 */
export const respondTool: LocalTool = defineTool(
  {
    name: 'respond',
    description: 'Envia uma resposta em linguagem natural ao usuário. Use para responder perguntas, explicações, conversas ou qualquer tarefa que não exija ferramentas externas.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Texto da resposta ao usuário.' } },
      required: ['message'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object', properties: { message: { type: 'string' } } },
    capabilities: [],
    pure: true,
  },
  (args) => {
    const msg = args.message;
    let text: string;
    if (typeof msg === 'string') {
      text = msg;
    } else if (Array.isArray(msg)) {
      const isDirEntries = msg.every((e) => typeof e === 'object' && e !== null && ('name' in e || 'type' in e));
      if (isDirEntries) {
        text = (msg as Array<{ name?: string; type?: string; size?: number }>)
          .map((e) => {
            const icon = e.type === 'dir' ? '📁' : '📄';
            const size = e.type === 'file' && (e.size ?? 0) > 0 ? ` (${Math.round((e.size ?? 0) / 1024)} KB)` : '';
            return `${icon} ${e.name ?? '?'}${size}`;
          })
          .join('\n');
      } else {
        text = JSON.stringify(msg, null, 2);
      }
    } else if (msg !== null && msg !== undefined && typeof msg === 'object') {
      text = JSON.stringify(msg, null, 2);
    } else {
      text = String(msg ?? '');
    }
    return { success: true, output: { message: text } };
  },
);

/** Conjunto de tools base do CloverOS REPL. */
export const demoTools: LocalTool[] = [respondTool, echoTool, concatTool];
