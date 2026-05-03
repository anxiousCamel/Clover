/**
 * Coder Agent — specialised agent for software implementation and code
 * generation tasks.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Agent, AgentContext } from '../../../../../shared/types/index.js';
import { TOOL_NAMES } from '../../../../../shared/types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Carrega o system prompt do arquivo .md adjacente (cache em module-scope). */
const SYSTEM_PROMPT = readFileSync(
  resolve(__dirname, 'system-prompt.md'),
  'utf-8',
);

/**
 * Regex pattern that matches common coding / implementation intents.
 */
// English + Portuguese intent patterns for code/file operations
const INTENT_PATTERN_EN =
  /\b(cod(e|ing)|implement|writ(e|ing)\s+(code|function|class|module|component|test|script|file)|creat(e|ing)\s+(a\s+)?(file|function|class|module|component|script|endpoint|service|handler|route|api)|fix(ing|es)?|refactor(ing)?|debug(ging)?|develop|program(ming)?|function|class\b|module|component|generat(e|ing)|scaffold|add\s+(a\s+)?(feature|method|endpoint|function|class|route|handler|field|column|property)|updat(e|ing)\s+(the\s+)?(code|file|function|class|module|implementation)|modif(y|ying)|chang(e|ing)\s+(the\s+)?(code|implementation|logic)|convert(ing)?|migrat(e|ing)|port(ing)?|typ(e|ing|escript)|interface|test(ing|s)?)\b/i;

const INTENT_PATTERN_PT =
  /\b(melhor(ar?|e)|edit(ar?|e)|cri(ar?|e)|alter(ar?|e)|corrig(ir|e|a)|escrev(er|a)|modific(ar?|e)|atualiz(ar?|e)|refator(ar?|e)|implement(ar?|e)|desenvolv(er|a)|program(ar?|e)|consert(ar?|e)|adicion(ar?|e)|coloc(ar?|a)|salv(ar?|e)|grav(ar?|e)|delet(ar?|e)|remov(er|a)|apag(ar?|e)|renome(ar?|i|e)|mov(er|a)|copi(ar?|e)|pode.*(criar|editar|melhorar|alterar|escrever|modificar|atualizar|adicionar|colocar|salvar|deletar|remover|apagar))\b/i;

/**
 * Filesystem context pattern — catches references to files/directories
 * even without an explicit action verb (e.g. "no arquivo", "neste arquivo").
 * Any message mentioning a file/directory in an actionable way should route here.
 */
const FS_CONTEXT_PATTERN =
  /\b(n[oa]s?\s+(arquivo|pasta|diretório|diretorio|ficheiro)|neste\s+(arquivo|ficheiro)|nessa?\s+(pasta|diretório|diretorio)|ao\s+arquivo|do\s+arquivo|para\s+o\s+arquivo|no\s+arquivo)\b/i;

const INTENT_PATTERN = {
  test: (msg: string) => INTENT_PATTERN_EN.test(msg) || INTENT_PATTERN_PT.test(msg) || FS_CONTEXT_PATTERN.test(msg),
};

/**
 * Determine whether a user message expresses a coding / implementation intent.
 */
function matchesIntent(message: string, _context?: AgentContext): boolean {
  return INTENT_PATTERN.test(message);
}

export const coderAgent: Agent = {
  name: 'coder',
  systemPrompt: SYSTEM_PROMPT,
  allowedTools: [
    TOOL_NAMES.READ_FILE,
    TOOL_NAMES.WRITE_FILE,
    TOOL_NAMES.EDIT_FILE,
    TOOL_NAMES.LIST_FILES,
    TOOL_NAMES.EXECUTE_COMMAND,
    TOOL_NAMES.SEARCH_MEMORY,
  ],
  matchesIntent,
  maxTurns: 12,
};

export default coderAgent;
