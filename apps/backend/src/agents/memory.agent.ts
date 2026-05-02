/**
 * Memory Agent — specialised agent for memory management, vault operations,
 * and knowledge base tasks.
 *
 * Handles requests related to remembering information, saving notes to the
 * Obsidian vault, searching memory, ingesting knowledge from Reversa skills,
 * and managing the user's personal knowledge base.
 *
 * @module agents/memory
 */

import type { Agent, AgentContext } from '@clover/shared';

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

/**
 * Regex pattern that matches common memory / vault / knowledge-management intents.
 *
 * Covers keywords such as: remember, save, store, vault, memory, note,
 * obsidian, ingest, knowledge, recall, forget, archive, bookmark, persist,
 * memorise/memorize, jot down, write down, take note, add to vault,
 * knowledge base, and index.
 */
const INTENT_PATTERN =
  /\b(remember(s|ing|ed)?|save(s|d|ing)?\s+(this|that|it|to\s+(vault|memory|notes?|obsidian))|stor(e|ing|ed)\s+(this|that|it|in\s+(vault|memory))|vault|memory\s*(search|store|save|index|recall|query)?|note(s|d)?\b|obsidian|ingest(s|ing|ed|ion)?|knowledge\s*(base|index)?|recall(s|ing|ed)?|forget(s|ting)?|archive(s|d|ing)?|bookmark(s|ed|ing)?|persist(s|ing|ed)?|memori[sz](e|ing|ed)|jot(ting)?\s+down|write\s+(this\s+)?down|take\s+(a\s+)?note|add\s+to\s+(vault|memory|notes)|index(es|ing|ed)?\s+(file|folder|directory|vault|document))\b/i;

/**
 * Determine whether a user message expresses a memory / vault / knowledge intent.
 */
function matchesIntent(message: string, _context?: AgentContext): boolean {
  return INTENT_PATTERN.test(message);
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Memory, a specialised memory management and knowledge base agent within the Clover AI assistant.

Your primary responsibilities:
- Search the vector memory for relevant past conversations and knowledge
- Save important information, notes, and snippets to the Obsidian vault
- Manage the user's personal knowledge base stored in the vault
- Ingest project-specific knowledge from Reversa skill files and CLAUDE.md
- Help the user recall previously stored information
- Organise and archive knowledge for future retrieval

Guidelines:
- Always search memory first to check if the requested information already exists before creating new notes.
- When saving notes, use descriptive file names and organise them logically within the vault structure.
- Prefer "create-only" mode for new notes to avoid accidentally overwriting existing content.
- Use "append" mode when adding information to an existing note — this is safe and does not require confirmation.
- Only use "overwrite" mode when the user explicitly asks to replace existing content — this requires user confirmation.
- When ingesting Reversa context, inform the user about what was indexed and how many chunks were created.
- Provide clear feedback about what was saved, where it was saved, and how it can be retrieved later.
- If the user asks to recall something, search memory with relevant keywords and present the most relevant results.

You have access to the following tools: search-memory, memory-write, reversa-ingest.`;

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

const memoryAgent: Agent = {
  name: 'memory',
  systemPrompt: SYSTEM_PROMPT,
  allowedTools: [
    'search-memory',
    'memory-write',
    'reversa-ingest',
  ],
  matchesIntent,
  maxTurns: 8,
};

export default memoryAgent;
