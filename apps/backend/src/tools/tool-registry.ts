/**
 * Tool Registry — auto-discovers tool plugins from the plugins/ directory,
 * validates arguments with Zod, checks confirmation requirements, and
 * routes execution through the Confirmation Bus when needed.
 */

import { glob } from 'glob';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { ToolPlugin, ToolContext, ToolResult } from '@clover/shared';
import * as confirmationBus from '../confirmation/confirmation.bus.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class ToolNotFoundError extends Error {
  constructor(name: string) {
    super(`Tool not found: ${name}`);
    this.name = 'ToolNotFoundError';
  }
}

export class ToolValidationError extends Error {
  public readonly details: z.ZodIssue[];

  constructor(toolName: string, issues: z.ZodIssue[]) {
    const summary = issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    super(`Validation failed for tool "${toolName}": ${summary}`);
    this.name = 'ToolValidationError';
    this.details = issues;
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const plugins = new Map<string, ToolPlugin>();

// ---------------------------------------------------------------------------
// Plugin loading
// ---------------------------------------------------------------------------

/**
 * Auto-discover all `*.tool.ts` (or compiled `*.tool.js`) files in the
 * `plugins/` directory relative to this file and register them.
 *
 * Each plugin module must default-export or named-export a `ToolPlugin`
 * object with a `name` property used as the registry key.
 */
export async function loadPlugins(): Promise<void> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const pluginsDir = path.join(currentDir, 'plugins');

  // Match both .ts (dev via tsx) and .js (compiled) extensions
  const pattern = path.join(pluginsDir, '*.tool.{ts,js}');
  const files = await glob(pattern, { windowsPathsNoEscape: true });

  for (const file of files) {
    const mod: Record<string, unknown> = await import(pathToFileURL(file).href);

    // Support both default export and named `plugin` export
    const plugin = (mod['default'] ?? mod['plugin']) as ToolPlugin | undefined;

    if (plugin && typeof plugin.name === 'string') {
      plugins.set(plugin.name, plugin);
    }
  }
}

/**
 * Return a read-only snapshot of all registered plugin names.
 */
export function listTools(): string[] {
  return Array.from(plugins.keys());
}

/**
 * Return the plugin instance for a given tool name, or undefined.
 */
export function getPlugin(name: string): ToolPlugin | undefined {
  return plugins.get(name);
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Execute a tool by name.
 *
 * 1. Look up the plugin by name.
 * 2. Validate `args` against the plugin's Zod `inputSchema`.
 * 3. If the plugin requires confirmation for these args, route through
 *    the Confirmation Bus and abort if the user denies.
 * 4. Call `plugin.execute` with the validated args and context.
 */
export async function execute(
  name: string,
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const plugin = plugins.get(name);
  if (!plugin) {
    throw new ToolNotFoundError(name);
  }

  // --- Zod validation ---
  const schema = plugin.inputSchema;
  if (schema instanceof z.ZodType) {
    const result = schema.safeParse(args);
    if (!result.success) {
      throw new ToolValidationError(name, result.error.issues);
    }
    // Use the parsed (coerced/defaulted) value for execution
    args = result.data;
  }

  // --- Confirmation check ---
  if (plugin.requiresConfirmation(args)) {
    const requestId = randomUUID();
    const approved = await confirmationBus.request({
      requestId,
      toolName: name,
      operation: name,
      details: `Executing tool "${name}" with provided arguments`,
      args,
    });

    if (!approved) {
      return {
        success: false,
        output: '',
        error: 'user_denied',
      };
    }
  }

  // --- Execute ---
  return plugin.execute(args, ctx);
}
