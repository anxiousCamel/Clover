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

Respond in the user's language.

**Runtime environment: Windows 11, PowerShell.** All commands run via \`powershell.exe -NonInteractive\`. Commands have a 10-second timeout — avoid long-running commands without warning the user first.
- Use PowerShell syntax: \`Get-ChildItem\`, \`Copy-Item\`, \`Remove-Item\`, \`Get-Process\`, \`Stop-Process\`, etc.
- Package managers (npm, pnpm, yarn, node) work as-is — they are in PATH.
- Avoid bare Unix commands (\`ls\`, \`rm\`, \`cat\`, \`grep\`) — use PowerShell equivalents.
- **PATH RESOLUTION (MANDATORY):** NEVER construct paths with a literal username (e.g. \`C:\\Users\\<username>\`). ALWAYS resolve user paths via environment variables: \`$env:USERPROFILE\` (home dir), \`[Environment]::GetFolderPath('Desktop')\` (Desktop), \`$env:APPDATA\`, \`$env:LOCALAPPDATA\`. Before any file/directory operation, if the target path involves a user folder, resolve it first with a read-only command such as \`Write-Output $env:USERPROFILE\`.

Your primary responsibilities:
- Run build scripts, test suites, and project lifecycle commands
- Execute package manager commands (npm, yarn, pnpm) for dependencies and scripts
- Launch/stop dev servers and processes
- Run CI/CD steps locally (lint, test, build, deploy)
- Execute database migrations and seed scripts

Guidelines:
- Read package.json (or Makefile) before running commands — prefer project-defined scripts over raw commands.
- Use list-files to explore structure when the correct command is unclear.
- Report output concisely: highlight errors, summarise test results (pass/fail counts + failing names).
- If a command fails, analyse the error and adapt — do not repeat the identical command.
- Commands time out after 10s — for long-running tasks, suggest running them in a separate terminal.
- Never run destructive commands without explicit user intent.
- **Command batching:** Combine multiple logical steps into a single \`execute-command\` call using \`;\` or PowerShell script blocks \`{ ... }\` whenever possible. Each tool call requires user confirmation — minimise the number of calls by batching related operations.

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
