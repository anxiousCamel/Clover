/**
 * Tasks prompt template — generates a structured prompt for the OpenClaude
 * AI to produce a tasks.md planning document.
 *
 * Takes a goal description along with the previously generated requirements
 * and design content, then returns a prompt string that enforces the strict
 * task format: `TASK-NNN | agent | depends:X | description | done when: criterion`.
 *
 * @module planner/templates/tasks
 */

// ---------------------------------------------------------------------------
// Input interface
// ---------------------------------------------------------------------------

/** Structured input for the tasks prompt template. */
export interface TasksPromptInput {
  /** The user's goal or project description. */
  goal: string;
  /** The full content of the previously generated requirements.md. */
  requirementsContent: string;
  /** The full content of the previously generated design.md. */
  designContent: string;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/**
 * Build a prompt string that instructs the AI to generate a tasks.md
 * document with a strictly enforced task format.
 */
export function buildTasksPrompt(input: TasksPromptInput): string {
  const { goal, requirementsContent, designContent } = input;

  return `You are a senior software architect and project planner. Given the project goal, requirements, and design below, generate a **tasks.md** document.

# Project Goal
${goal}

# Requirements
${requirementsContent}

# Design
${designContent}

---

# Output Instructions

You MUST produce a Markdown document containing a task list. Every task MUST follow this exact pipe-delimited format:

\`\`\`
TASK-NNN | agent | depends:X | description | done when: criterion
\`\`\`

Where:
- **TASK-NNN** — a zero-padded three-digit sequential task number (TASK-001, TASK-002, …)
- **agent** — the responsible agent type, one of: \`planner\`, \`coder\`, \`reviewer\`, \`executor\`, \`researcher\`, \`memory\`
- **depends:X** — comma-separated list of prerequisite task numbers (e.g., \`depends:TASK-001,TASK-002\`), or \`depends:none\` if the task has no dependencies
- **description** — a concise but complete description of what the task accomplishes
- **done when: criterion** — a measurable acceptance criterion that defines when the task is complete

## Rules

1. Tasks MUST be ordered so that dependencies are listed before dependents.
2. Each task MUST map to one or more functional requirements (FR-NNN) or non-functional requirements (NF-NNN) from the requirements document.
3. Include a comment after each task referencing the requirement(s) it addresses, e.g., \`<!-- FR-001, NF-003 -->\`.
4. Group related tasks under Markdown headings that correspond to major components or features from the design document.
5. Keep tasks small and atomic — each task should be completable by a single agent in one session.
6. Include at least one \`reviewer\` task after each major implementation group to verify quality.
7. Include \`executor\` tasks for running builds, tests, or deployments where appropriate.

---

Respond ONLY with the Markdown document. Do not include any preamble, explanation, or commentary outside the document.`;
}
