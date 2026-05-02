/**
 * Design prompt template — generates a structured prompt for the OpenClaude
 * AI to produce a design.md planning document.
 *
 * Takes a goal description, the previously generated requirements content,
 * workspace file tree, and memory chunks, then returns a prompt string that
 * enforces Architecture, Components, DataFlow, and Decisions sections.
 *
 * @module planner/templates/design
 */

import type { Chunk } from '@clover/shared';

// ---------------------------------------------------------------------------
// Input interface
// ---------------------------------------------------------------------------

/** Structured input for the design prompt template. */
export interface DesignPromptInput {
  /** The user's goal or project description. */
  goal: string;
  /** The full content of the previously generated requirements.md. */
  requirementsContent: string;
  /** Flat list of file paths representing the workspace structure. */
  fileTree: string[];
  /** Relevant memory chunks retrieved via RAG search. */
  memoryChunks: Chunk[];
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/**
 * Build a prompt string that instructs the AI to generate a design.md
 * document with strictly enforced sections.
 */
export function buildDesignPrompt(input: DesignPromptInput): string {
  const { goal, requirementsContent, fileTree, memoryChunks } = input;

  const fileTreeBlock =
    fileTree.length > 0
      ? `## Workspace File Tree\n\`\`\`\n${fileTree.join('\n')}\n\`\`\``
      : '## Workspace File Tree\n_No files found._';

  const memoryBlock =
    memoryChunks.length > 0
      ? `## Relevant Memory Context\n${memoryChunks.map((c) => `- [${c.source}] ${c.text}`).join('\n')}`
      : '';

  return `You are a senior software architect. Given the project goal, requirements, and context below, generate a **design.md** document.

# Project Goal
${goal}

# Requirements
${requirementsContent}

${fileTreeBlock}

${memoryBlock}

---

# Output Instructions

You MUST produce a Markdown document with **exactly** the following four top-level sections in this order. Do not add, remove, or rename sections.

## 1. Architecture
Describe the high-level system architecture. Include:
- A text-based architecture diagram (ASCII or Mermaid)
- The major layers or tiers of the system
- Communication protocols between components
- Deployment topology (if relevant)

## 2. Components
For each component or module, provide:
- **Name** — a clear identifier
- **Responsibility** — what it does (single-responsibility)
- **Interfaces** — the public API it exposes (methods, events, endpoints)
- **Dependencies** — what it depends on (other components, external services)

Present components in a table or structured list.

## 3. Data Flow
Describe the key data flows through the system using sequence diagrams (Mermaid preferred) or numbered step lists. Cover at minimum:
- The primary happy-path flow
- Any flow involving user confirmation or approval
- Error / fallback flows where relevant

## 4. Technical Decisions
Document each significant technical decision as a record:
- **Decision** — what was decided
- **Rationale** — why this option was chosen
- **Alternatives considered** — what else was evaluated
- **Trade-offs** — known downsides or risks

---

Respond ONLY with the Markdown document. Do not include any preamble, explanation, or commentary outside the document.`;
}
