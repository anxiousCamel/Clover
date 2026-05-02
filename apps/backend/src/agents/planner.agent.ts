/**
 * Planner Agent — specialised agent for project planning and document
 * generation tasks.
 *
 * Handles requests related to planning, designing, defining requirements,
 * architecture, roadmaps, specifications, and generating structured
 * planning documents. Has access to file listing, file reading, and
 * memory search tools.
 *
 * @module agents/planner
 */

import type { Agent, AgentContext } from '@clover/shared';

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

/**
 * Regex pattern that matches common planning / design / architecture intents.
 *
 * Covers keywords such as: plan, design, requirements, architecture, /plan,
 * roadmap, spec, specification, blueprint, strategy, outline, scope,
 * milestone, epic, user story, backlog, sprint, proposal, rfc, adr,
 * decision record, system design, technical design, high-level design,
 * project structure, breakdown, decompose, and estimate.
 */
const INTENT_PATTERN =
  /\b(plan(ning|ned|s)?|design(ing|ed|s)?|requirement(s)?|architectur(e|al|ing)|\/plan\b|roadmap(s)?|spec(s|ification|ifications)?|blueprint(s)?|strateg(y|ies|ic)|outline(s|d)?|scop(e|ing)|milestone(s)?|epic(s)?|user\s+stor(y|ies)|backlog|sprint\s+plan(ning)?|proposal(s)?|rfc|adr|decision\s+record|system\s+design|technical\s+design|high[- ]level\s+design|project\s+structur(e|ing)|break(down|ing\s+down)|decompos(e|ing|ition)|estimat(e|ing|ion))\b/i;

/**
 * Determine whether a user message expresses a planning / design intent.
 */
function matchesIntent(message: string, _context?: AgentContext): boolean {
  return INTENT_PATTERN.test(message);
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Planner, a specialised project planning and document generation agent within the Clover AI assistant.

Your primary responsibilities:
- Generate structured planning documents: requirements.md, design.md, and tasks.md
- Define clear project requirements with acceptance criteria
- Design system architecture with component diagrams and data flows
- Break down projects into actionable, well-scoped tasks with dependencies
- Create roadmaps, milestones, and sprint plans
- Analyse existing codebases to inform planning decisions

Guidelines:
- Always search memory and read existing project files before generating plans to ground your output in the current project context.
- Use the workspace file listing to understand the project structure before proposing architectural changes.
- Structure requirements using the format: User Story → Acceptance Criteria with WHEN/THEN/IF conditions.
- Structure design documents with: Overview, Architecture, Components, Data Flow, and Technical Decisions sections.
- Structure task lists with clear dependencies, assigned agent type, and "done when" criteria.
- Prefer incremental plans that build on existing code rather than proposing full rewrites.
- When scope is ambiguous, state your assumptions and propose a minimal viable plan first.
- Always consider non-functional requirements: performance, security, maintainability, and testability.
- If the project already has planning documents, read them first and propose updates rather than replacements.

You have access to the following tools: list-files, read-file, search-memory.`;

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

const plannerAgent: Agent = {
  name: 'planner',
  systemPrompt: SYSTEM_PROMPT,
  allowedTools: [
    'list-files',
    'read-file',
    'search-memory',
  ],
  matchesIntent,
  maxTurns: 10,
};

export default plannerAgent;
