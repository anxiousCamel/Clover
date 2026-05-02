/**
 * Coder Agent — specialised agent for software implementation and code
 * generation tasks.
 *
 * Handles requests related to writing, creating, fixing, and refactoring
 * code within the user's workspace. Has access to file operations,
 * command execution, and memory search tools.
 *
 * @module agents/coder
 */

import type { Agent, AgentContext } from '@clover/shared';

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

/**
 * Regex pattern that matches common coding / implementation intents.
 *
 * Covers keywords such as: code, implement, write, create, fix, refactor,
 * debug, build, develop, program, function, class, module, component,
 * generate, scaffold, add (feature/method/endpoint), update, modify, change,
 * convert, migrate, port, type, interface, and test.
 */
const INTENT_PATTERN =
  /\b(cod(e|ing)|implement|writ(e|ing)\s+(code|function|class|module|component|test|script|file)|creat(e|ing)\s+(a\s+)?(file|function|class|module|component|script|endpoint|service|handler|route|api)|fix(ing|es)?|refactor(ing)?|debug(ging)?|develop|program(ming)?|function|class\b|module|component|generat(e|ing)|scaffold|add\s+(a\s+)?(feature|method|endpoint|function|class|route|handler|field|column|property)|updat(e|ing)\s+(the\s+)?(code|file|function|class|module|implementation)|modif(y|ying)|chang(e|ing)\s+(the\s+)?(code|implementation|logic)|convert(ing)?|migrat(e|ing)|port(ing)?|typ(e|ing|escript)|interface|test(ing|s)?)\b/i;

/**
 * Determine whether a user message expresses a coding / implementation intent.
 */
function matchesIntent(message: string, _context?: AgentContext): boolean {
  return INTENT_PATTERN.test(message);
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Coder, a specialised software implementation agent within the Clover AI assistant.

Your primary responsibilities:
- Write clean, idiomatic, well-documented code
- Create new files, modules, and components
- Fix bugs and resolve errors
- Refactor existing code for clarity and performance
- Generate tests alongside implementation code
- Follow the conventions and patterns already present in the workspace

Guidelines:
- Always read relevant existing files before making changes so you understand the current patterns and style.
- Prefer small, focused edits over full-file rewrites. Use the edit-file tool for surgical changes.
- When creating new files, ensure they integrate with the existing project structure (imports, exports, naming conventions).
- Validate your changes compile correctly when possible by running the project's build or lint command.
- If a task is ambiguous, state your assumptions before proceeding.
- Never execute destructive commands without explicit user intent.

You have access to the following tools: read-file, write-file, edit-file, list-files, execute-command, search-memory.`;

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

const coderAgent: Agent = {
  name: 'coder',
  systemPrompt: SYSTEM_PROMPT,
  allowedTools: [
    'read-file',
    'write-file',
    'edit-file',
    'list-files',
    'execute-command',
    'search-memory',
  ],
  matchesIntent,
  maxTurns: 12,
};

export default coderAgent;
