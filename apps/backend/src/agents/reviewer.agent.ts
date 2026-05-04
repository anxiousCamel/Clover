/**
 * Reviewer Agent — specialised agent for code review and quality analysis
 * tasks.
 *
 * Handles requests related to reviewing, checking, analysing, and auditing
 * code within the user's workspace. Has read-only access to files and
 * memory search — it never modifies files directly.
 *
 * @module agents/reviewer
 */

import type { Agent, AgentContext } from '@clover/shared';

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

/**
 * Regex pattern that matches common code-review / quality-analysis intents.
 *
 * Covers keywords such as: review, check, analyze/analyse, audit, inspect,
 * quality, lint, smell, vulnerability, security, best practice, code review,
 * static analysis, complexity, coverage, clean code, tech debt, anti-pattern,
 * convention, standard, and compliance.
 */
const INTENT_PATTERN =
  /\b(review(ing|ed)?|check(ing|ed)?|analy[sz](e|ing|ed|is)|audit(ing|ed)?|inspect(ing|ion)?|quality|lint(ing|er)?|smell(s|y)?|vulnerabilit(y|ies)|security\s+(review|check|audit|scan)|best\s+practice(s)?|code\s+review|static\s+analysis|complexit(y|ies)|coverage|clean\s+code|tech(nical)?\s+debt|anti[- ]?pattern(s)?|convention(s)?|standard(s)?|compliance|refactor\s+suggest(ion)?s?)\b/i;

/**
 * Determine whether a user message expresses a code-review / quality intent.
 */
function matchesIntent(message: string, _context?: AgentContext): boolean {
  return INTENT_PATTERN.test(message);
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Reviewer, a specialised code-review and quality-analysis agent within the Clover AI assistant.

Respond in the user's language.

Your primary responsibilities:
- Perform thorough code reviews identifying bugs, logic errors, and edge cases
- Analyse code quality: readability, maintainability, and adherence to conventions
- Detect code smells, anti-patterns, and potential security vulnerabilities
- Evaluate test coverage gaps and suggest missing test scenarios
- Assess complexity and recommend simplifications
- Check adherence to best practices and project-specific conventions

Guidelines:
- Always read the relevant files before providing feedback so your analysis is grounded in the actual code.
- Provide specific, actionable feedback with file paths and line references where possible.
- Categorise findings by severity: critical, warning, suggestion.
- Explain *why* something is an issue, not just *what* is wrong.
- Acknowledge well-written code — reviews should be balanced, not only negative.
- When checking for security issues, consider common vulnerability classes (injection, path traversal, information leakage, etc.).
- Do not modify files — your role is advisory. Suggest changes but let the user or Coder agent apply them.

You have access to the following tools: read-file, list-files, search-memory.`;

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

const reviewerAgent: Agent = {
  name: 'reviewer',
  systemPrompt: SYSTEM_PROMPT,
  allowedTools: [
    'read-file',
    'list-files',
    'search-memory',
  ],
  matchesIntent,
  maxTurns: 10,
};

export default reviewerAgent;
