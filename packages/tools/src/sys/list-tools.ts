/**
 * sys/list-tools — Catálogo vivo de ferramentas registradas.
 *
 * Ferramenta `list_available_tools`: expõe o catálogo completo (nome, descrição,
 * intent, schema de entrada) para consultas como "quais ferramentas você possui?",
 * "o que você sabe fazer?", "liste suas capacidades". O catálogo é populado via
 * `setCatalog()` pelo CLI após registro no Kernel — evita dependência circular.
 */

import type { ToolDescriptor } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';
import { z } from 'zod';

import { defineZodTool } from '../abi.js';

/** Catálogo populado pelo CLI após `kernel.registerTools`. */
let catalog: ToolDescriptor[] = [];

/** Popula o catálogo (chamado pelo CLI após registrar as tools no Kernel). */
export function setCatalog(tools: ToolDescriptor[]): void {
  catalog = [...tools];
}

export const listAvailableToolsTool: LocalTool = defineZodTool({
  name: 'list_available_tools',
  description:
    'Retorna o catálogo completo de TODAS as ferramentas disponíveis: nome, descrição, intent e schema de entrada. USE ESTA para responder perguntas como "quais ferramentas você possui?", "o que você sabe fazer?", "liste suas capacidades", "quais ferramentas estão disponíveis?", "help", "ajuda". Retorna o total de ferramentas registradas.',
  input: z.object({}).strict(),
  output: z.object({
    tools: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        intent: z.string(),
        inputSchema: z.unknown(),
      }),
    ),
    total: z.number(),
  }),
  capabilities: [{ kind: 'fs.read' }],
  intent: 'read',
  pure: true,
  run: () => ({
    tools: catalog.map((t) => ({
      name: t.name,
      description: t.description,
      intent: t.intent ?? 'read',
      inputSchema: t.inputSchema,
    })),
    total: catalog.length,
  }),
});