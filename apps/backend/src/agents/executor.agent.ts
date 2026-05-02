/**
 * Executor Agent — specialised agent for running commands, builds, tests,
 * and deployments.
 *
 * Handles requests related to executing shell commands, running build
 * pipelines, launching test suites, and managing project lifecycle tasks.
 * Has access to command execution, file listing, and file reading tools.
 *
 * @module agents/executor
 */

import type { Agent, AgentContext } from '@clover/shared';

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

/**
 * Regex pattern that matches common execution / build / test intents.
 *
 * Covers keywords such as: run, execute, test, build, deploy, compile,
 * install, start, stop, restart, npm, yarn, pnpm, make, docker, launch,
 * serve, script, ci, pipeline, lint (as a run action), bundle, package,
 * publish, migrate, seed, and clean.
 */
const INTENT_PATTERN =
  /\b(run(ning|s)?|execut(e|ing|ion)|test(s|ing)?|build(s|ing)?|deploy(s|ing|ment)?|compil(e|ing|ation)|install(s|ing)?|start(s|ing)?|stop(s|ping)?|restart(s|ing)?|npm\s|yarn\s|pnpm\s|make\b|docker\s|launch(es|ing)?|serv(e|ing)|script(s)?|ci\b|pipeline(s)?|lint(s|ing)?|bundl(e|ing)|packag(e|ing)|publish(es|ing)?|migrat(e|ing|ion)|seed(ing)?|clean(ing)?)\b/i;

/**
 * Determine whether a user message expresses an execution / build / test intent.
 */
function matchesIntent(message: string, _context?: AgentContext): boolean {
  return INTENT_PATTERN.test(message);
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Executor, a specialised command-execution and build-management agent within the Clover AI assistant.

Your primary responsibilities:
- Run shell commands, build scripts, and test suites on behalf of the user
- Execute package manager commands (npm, yarn, pnpm) for installing dependencies and running scripts
- Launch development servers and stop running processes
- Run CI/CD pipeline steps locally (lint, test, build, deploy)
- Execute database migrations and seed scripts
- Monitor command output and report results clearly

Guidelines:
- Always read relevant project files (package.json, Makefile, etc.) before running commands so you understand the available scripts and project setup.
- Use the list-files tool to explore the project structure when needed to determine the correct commands.
- Prefer project-defined scripts (e.g. \`npm run build\`) over raw commands when available.
- Report command output clearly, highlighting errors and warnings.
- If a command fails, analyse the output and suggest fixes or next steps.
- Never run destructive commands without explicit user intent — the confirmation system will prompt the user, but you should still exercise caution.
- Be mindful of long-running commands; inform the user if a command may take significant time.
- When running tests, summarise the results (pass/fail counts, failing test names) rather than dumping raw output.

You have access to the following tools: execute-command, list-files, read-file.`;

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

const executorAgent: Agent = {
  name: 'executor',
  systemPrompt: SYSTEM_PROMPT,
  allowedTools: [
    'execute-command',
    'list-files',
    'read-file',
  ],
  matchesIntent,
  maxTurns: 8,
};

export default executorAgent;
