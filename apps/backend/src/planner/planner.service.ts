/**
 * Planner Service — orchestrates a 4-phase planning pipeline that generates
 * structured project documents (requirements.md, design.md, tasks.md) from
 * a user-provided goal description.
 *
 * Phases:
 *   1. **Context** — scan workspace files, RAG search, Reversa context
 *   2. **Requirements** — generate via OpenClaude with requirements template
 *   3. **Design** — generate with design template using requirements output
 *   4. **Tasks** — generate with tasks template using requirements + design
 *
 * Each generated file is written via the Obsidian adapter with mode
 * `"create-only"` to prevent silent overwrites of existing planning docs.
 *
 * The service accepts an `emit` callback so the gateway layer can push
 * `planner:progress` and `planner:done` WebSocket events to the client.
 *
 * @module planner/planner.service
 */

import { readdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Chunk } from '@clover/shared';
import * as openclaude from '../openclaude/openclaude.client.js';
import * as memory from '../memory/memory.service.js';
import * as obsidian from '../memory/obsidian.adapter.js';
import { buildRequirementsPrompt } from './templates/requirements.prompt.js';
import { buildDesignPrompt } from './templates/design.prompt.js';
import { buildTasksPrompt } from './templates/tasks.prompt.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback used to push WebSocket events from the gateway layer. */
export type EmitFn = (type: string, data: unknown) => void;

/** Phases the planner pipeline progresses through. */
export type PlannerPhase = 'context' | 'requirements' | 'design' | 'tasks';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all file paths under `dirPath`, returning paths
 * relative to `basePath`.  Silently skips directories that cannot be read
 * (e.g. permission errors, symlink loops).
 */
async function scanFileTree(
  dirPath: string,
  basePath: string,
): Promise<string[]> {
  const results: string[] = [];

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    const relativePath = fullPath.slice(basePath.length + 1);

    if (entry.isDirectory()) {
      // Skip common non-project directories
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === 'dist' ||
        entry.name === '.next'
      ) {
        continue;
      }
      const nested = await scanFileTree(fullPath, basePath);
      results.push(...nested);
    } else {
      results.push(relativePath);
    }
  }

  return results;
}

/**
 * Attempt to read the Reversa context files (CLAUDE.md and .agents/skills/)
 * from the workspace.  Returns an empty string when nothing is found.
 */
async function loadReversaContext(workspacePath: string): Promise<string> {
  const parts: string[] = [];

  // Try CLAUDE.md
  try {
    const claudePath = join(workspacePath, 'CLAUDE.md');
    const content = await readFile(claudePath, 'utf-8');
    parts.push(`## CLAUDE.md\n${content}`);
  } catch {
    // File does not exist — skip
  }

  // Try .agents/skills/
  try {
    const skillsDir = join(workspacePath, '.agents', 'skills');
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const mdFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => join(skillsDir, e.name));

    for (const file of mdFiles) {
      const content = await readFile(file, 'utf-8');
      parts.push(`## ${file}\n${content}`);
    }
  } catch {
    // Directory does not exist — skip
  }

  return parts.join('\n\n');
}

/**
 * Emit a `planner:progress` event for the given phase.
 */
function emitProgress(emit: EmitFn, phase: PlannerPhase, status: string): void {
  emit('planner:progress', { phase, status });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the full 4-phase planning pipeline and write the resulting documents
 * to the workspace via the Obsidian adapter.
 *
 * @param goal          - The user's goal or project description.
 * @param workspacePath - Absolute path to the target workspace directory.
 * @param emit          - Callback to push WebSocket events to the client.
 * @returns Array of file paths that were successfully written.
 */
export async function generate(
  goal: string,
  workspacePath: string,
  emit: EmitFn,
): Promise<string[]> {
  const generatedFiles: string[] = [];

  // ── Phase 1: Context ────────────────────────────────────────────────
  emitProgress(emit, 'context', 'scanning workspace');

  const fileTree = await scanFileTree(workspacePath, workspacePath);
  const memoryChunks: Chunk[] = await memory.search(goal);
  const reversaContext = await loadReversaContext(workspacePath);

  emitProgress(emit, 'context', 'done');

  // ── Phase 2: Requirements ───────────────────────────────────────────
  emitProgress(emit, 'requirements', 'generating');

  const requirementsPrompt = buildRequirementsPrompt({
    goal,
    fileTree,
    memoryChunks,
    reversaContext,
  });

  const requirementsResult = await openclaude.complete({
    messages: [{ role: 'user', content: requirementsPrompt }],
  });
  const requirementsContent = requirementsResult.message.content;

  const requirementsPath = 'requirements.md';
  await obsidian.writeNote(requirementsPath, requirementsContent, 'create-only');
  generatedFiles.push(requirementsPath);

  emitProgress(emit, 'requirements', 'done');

  // ── Phase 3: Design ─────────────────────────────────────────────────
  emitProgress(emit, 'design', 'generating');

  const designPrompt = buildDesignPrompt({
    goal,
    requirementsContent,
    fileTree,
    memoryChunks,
  });

  const designResult = await openclaude.complete({
    messages: [{ role: 'user', content: designPrompt }],
  });
  const designContent = designResult.message.content;

  const designPath = 'design.md';
  await obsidian.writeNote(designPath, designContent, 'create-only');
  generatedFiles.push(designPath);

  emitProgress(emit, 'design', 'done');

  // ── Phase 4: Tasks ──────────────────────────────────────────────────
  emitProgress(emit, 'tasks', 'generating');

  const tasksPrompt = buildTasksPrompt({
    goal,
    requirementsContent,
    designContent,
  });

  const tasksResult = await openclaude.complete({
    messages: [{ role: 'user', content: tasksPrompt }],
  });
  const tasksContent = tasksResult.message.content;

  const tasksPath = 'tasks.md';
  await obsidian.writeNote(tasksPath, tasksContent, 'create-only');
  generatedFiles.push(tasksPath);

  emitProgress(emit, 'tasks', 'done');

  // ── Done ────────────────────────────────────────────────────────────
  emit('planner:done', { files: generatedFiles });

  return generatedFiles;
}
