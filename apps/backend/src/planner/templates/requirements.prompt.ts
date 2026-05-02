/**
 * Requirements prompt template — generates a structured prompt for the
 * OpenClaude AI to produce a requirements.md planning document.
 *
 * Takes a goal description along with workspace context (file tree, memory
 * chunks, Reversa context) and returns a prompt string that enforces the
 * expected output format with FR, NF, Constraints, and Out-of-Scope sections.
 *
 * @module planner/templates/requirements
 */

import type { Chunk } from '@clover/shared';

// ---------------------------------------------------------------------------
// Input interface
// ---------------------------------------------------------------------------

/** Structured input for the requirements prompt template. */
export interface RequirementsPromptInput {
  /** The user's goal or project description. */
  goal: string;
  /** Flat list of file paths representing the workspace structure. */
  fileTree: string[];
  /** Relevant memory chunks retrieved via RAG search. */
  memoryChunks: Chunk[];
  /** Reversa skill / CLAUDE.md context, if available. */
  reversaContext: string;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/**
 * Build a prompt string that instructs the AI to generate a requirements.md
 * document with strictly enforced sections.
 */
export function buildRequirementsPrompt(input: RequirementsPromptInput): string {
  const { goal, fileTree, memoryChunks, reversaContext } = input;

  const fileTreeBlock =
    fileTree.length > 0
      ? `## Workspace File Tree\n\`\`\`\n${fileTree.join('\n')}\n\`\`\``
      : '## Workspace File Tree\n_No files found._';

  const memoryBlock =
    memoryChunks.length > 0
      ? `## Relevant Memory Context\n${memoryChunks.map((c) => `- [${c.source}] ${c.text}`).join('\n')}`
      : '';

  const reversaBlock =
    reversaContext.trim().length > 0
      ? `## Reversa / Project Context\n${reversaContext}`
      : '';

  return `You are a senior software architect. Given the project goal and context below, generate a **requirements.md** document.

# Project Goal
${goal}

${fileTreeBlock}

${memoryBlock}

${reversaBlock}

---

# Output Instructions

You MUST produce a Markdown document with **exactly** the following four top-level sections in this order. Do not add, remove, or rename sections.

## 1. Functional Requirements (FR)
List every functional requirement as a numbered item (FR-001, FR-002, …). Each item must include:
- A short title
- A user story in the format: "As a <role>, I want <capability>, so that <benefit>."
- One or more acceptance criteria using WHEN / THEN / IF conditions

## 2. Non-Functional Requirements (NF)
List non-functional requirements as numbered items (NF-001, NF-002, …). Cover at minimum: performance, security, reliability, and maintainability where relevant to the goal.

## 3. Constraints
List any technical, business, or environmental constraints that limit the solution space (e.g., must run offline, no Docker, specific language/framework).

## 4. Out of Scope
Explicitly list features or concerns that are intentionally excluded from this iteration.

---

Respond ONLY with the Markdown document. Do not include any preamble, explanation, or commentary outside the document.`;
}
