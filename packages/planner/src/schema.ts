/**
 * Geração do JSON Schema que RESTRINGE a saída do modelo a um Plan IR válido
 * referenciando apenas as tools disponíveis (ADR-004: constrained decoding).
 *
 * O schema constrange a ESTRUTURA e os NOMES de tool (enum). A correção
 * semântica dos args é verificada depois pelo validator (`@clover/ir`) +
 * checagem leve no Planner — separação deliberada entre constraint estrutural
 * (no decoder) e validação semântica (determinística).
 */

import type { JsonSchema, ToolDescriptor } from '@clover/contracts';

/** Schema de uma referência a saída de nó (IRRef). */
const refSchema: JsonSchema = {
  type: 'object',
  properties: {
    kind: { const: 'ref' },
    nodeId: { type: 'string' },
    path: { type: 'string' },
  },
  required: ['kind', 'nodeId'],
  additionalProperties: false,
};

/**
 * Constrói o schema do Plan IR para um conjunto de tools. O campo `tool` de
 * cada nó fica restrito ao enum dos nomes disponíveis — o modelo não consegue
 * "inventar" uma ferramenta.
 */
export function buildPlanSchema(tools: ToolDescriptor[]): JsonSchema {
  const toolNames = tools.map((t) => t.name);
  return {
    type: 'object',
    properties: {
      version: { const: '1' },
      goalId: { type: 'string' },
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { const: 'tool_call' },
            id: { type: 'string' },
            tool: toolNames.length > 0 ? { enum: toolNames } : { type: 'string' },
            // args é um objeto livre (valores podem ser literais ou IRRef);
            // a validação de args contra o inputSchema da tool é semântica.
            args: { type: 'object' },
          },
          required: ['kind', 'id', 'tool', 'args'],
        },
      },
      edges: {
        type: 'array',
        items: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' } },
          required: ['from', 'to'],
          additionalProperties: false,
        },
      },
      outputs: { type: 'array', items: refSchema },
    },
    required: ['version', 'goalId', 'nodes', 'outputs'],
  };
}
