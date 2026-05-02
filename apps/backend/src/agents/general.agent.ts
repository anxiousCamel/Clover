/**
 * General Agent — catch-all agent for general conversation and tasks
 * that don't match any specialised agent.
 *
 * This agent handles greetings, casual conversation, general questions,
 * and any message that doesn't trigger a more specific agent.
 * It is registered last so specialised agents always take priority.
 *
 * @module agents/general
 */

import type { Agent, AgentContext } from '@clover/shared';

/**
 * Always returns true — this is the catch-all fallback agent.
 */
function matchesIntent(_message: string, _context?: AgentContext): boolean {
  return true;
}

const SYSTEM_PROMPT = `You are Clover, a helpful local AI assistant running entirely on the user's machine.

You can help with:
- General questions and conversation
- Explaining concepts and ideas
- Brainstorming and problem-solving
- Providing guidance on next steps

When the user asks about coding, planning, or other specialised tasks, you can help directly or suggest they phrase their request more specifically so a specialised agent can handle it.

Be concise, friendly, and helpful. You run locally — no data leaves the user's machine.`;

const generalAgent: Agent = {
  name: 'general',
  systemPrompt: SYSTEM_PROMPT,
  allowedTools: [
    'read-file',
    'list-files',
    'search-memory',
    'search-online',
  ],
  matchesIntent,
  maxTurns: 6,
};

export default generalAgent;
