/**
 * Researcher Agent — specialised agent for information gathering, research,
 * and explanation tasks.
 *
 * Handles requests related to researching topics, explaining concepts,
 * finding information, searching online and in memory, and answering
 * knowledge-based questions. Has access to online search, memory search,
 * and file reading tools.
 *
 * @module agents/researcher
 */

import type { Agent, AgentContext } from '@clover/shared';

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

/**
 * Regex pattern that matches common research / information-gathering intents.
 *
 * Covers keywords such as: research, explain, find, search, what is, how does,
 * why, look up, documentation, learn, understand, compare, difference, tell me,
 * describe, define, meaning, info, information, summarise/summarize, overview,
 * guide, tutorial, reference, clarify, elaborate, and detail.
 */
const INTENT_PATTERN =
  /\b(research(ing|ed)?|explain(s|ing|ed)?|find(s|ing)?\s+(info|out|about|documentation|details)|search(ing|ed)?\s+(for|about|online|the\s+web)|what\s+(is|are|does|was|were)|how\s+(does|do|did|to|is|are|can|could|would|should)|why\s+(does|do|did|is|are|can|would|should)|look(ing)?\s+up|documentation|learn(ing)?\s+about|understand(ing)?|compar(e|ing|ison)|differenc(e|es)\s+between|tell\s+me\s+(about|what|how|why)|describ(e|ing)|defin(e|ition|ing)|meaning\s+of|info(rmation)?\s+(about|on|regarding)|summari[sz](e|ing)|overview\s+of|guide\s+(to|for|on)|tutorial|reference|clarif(y|ying|ication)|elaborat(e|ing)|detail(s|ed)?\s+(about|on|regarding))\b/i;

/**
 * Determine whether a user message expresses a research / information-gathering intent.
 */
function matchesIntent(message: string, _context?: AgentContext): boolean {
  return INTENT_PATTERN.test(message);
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Researcher, a specialised information-gathering and explanation agent within the Clover AI assistant.

Respond in the user's language.

Your primary responsibilities:
- Research topics using online search and local memory to provide accurate, up-to-date information
- Explain technical concepts, APIs, libraries, and frameworks clearly and concisely
- Find relevant documentation, guides, and references for the user's questions
- Compare technologies, approaches, and patterns with balanced analysis
- Summarise complex topics into digestible explanations
- Answer "what is", "how does", and "why" questions with depth and clarity

Guidelines:
- Always search memory first to leverage existing knowledge before searching online.
- When searching online, use specific and targeted queries to get the most relevant results.
- Read relevant project files when the question relates to the user's codebase to ground your answers in context.
- Provide sources and references when citing external information.
- Structure explanations logically: start with a high-level summary, then dive into details.
- When comparing options, present pros and cons objectively rather than pushing a single recommendation.
- If information is uncertain or potentially outdated, clearly state that caveat.
- Tailor the depth of explanation to the complexity of the question — simple questions get concise answers, complex topics get thorough treatment.

You have access to the following tools: search-online, search-memory, read-file.`;

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

const researcherAgent: Agent = {
  name: 'researcher',
  systemPrompt: SYSTEM_PROMPT,
  allowedTools: [
    'search-online',
    'search-memory',
    'read-file',
  ],
  matchesIntent,
  maxTurns: 8,
};

export default researcherAgent;
