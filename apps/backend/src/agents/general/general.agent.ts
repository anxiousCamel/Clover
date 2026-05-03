/**
 * Agente fallback — captura mensagens que nenhum agente especializado
 * tratou. Tem acesso completo a todas as ferramentas para garantir que
 * nenhum pedido do usuário fique sem execução.
 *
 * @module agents/general
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Agent } from '../../../../../shared/types/index.js';
import { TOOL_NAMES } from '../../../../../shared/types/index.js';

/** Turnos máximos para conversa casual. */
const MAX_TURNS_FALLBACK = 4;

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Carrega o system prompt do arquivo .md adjacente (cache em module-scope). */
const SYSTEM_PROMPT = readFileSync(
  resolve(__dirname, 'system-prompt.md'),
  'utf-8',
);

/**
 * Agente catch-all read-only.
 * Registrado por último; ativado apenas quando nenhum agente especializado bate.
 */
export const generalAgent: Agent = {
  name: 'general',
  isFallback: true,
  systemPrompt: SYSTEM_PROMPT,
  allowedTools: [
    TOOL_NAMES.READ_FILE,
    TOOL_NAMES.WRITE_FILE,
    TOOL_NAMES.EDIT_FILE,
    TOOL_NAMES.LIST_FILES,
    TOOL_NAMES.SEARCH_MEMORY,
    TOOL_NAMES.SEARCH_ONLINE,
    TOOL_NAMES.EXECUTE_COMMAND,
  ],
  maxTurns: MAX_TURNS_FALLBACK,
};

// Also export default for the loader to pick up if it expects default
export default generalAgent;
