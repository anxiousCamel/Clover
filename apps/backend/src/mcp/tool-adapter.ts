/**
 * MCP Tool Adapter — wraps MCP tool definitions as Clover ToolPlugins.
 *
 * Converts JSON Schema input definitions to Zod via `jsonSchemaToZod`,
 * prefixes tool names with the originating server name to avoid collisions,
 * and delegates execution to the provided `callFn`.
 *
 * Returns `null` when a tool's schema cannot be converted, allowing the
 * caller to skip unconvertible tools gracefully.
 */

import type { ToolPlugin, ToolResult } from '@clover/shared';
import { jsonSchemaToZod, type JSONSchemaProperty } from './schema-converter.js';
import { SchemaConversionError } from '../errors/mcp-errors.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchemaProperty;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Wrap an MCP tool definition as a Clover ToolPlugin.
 *
 * The returned plugin:
 * - Uses `${serverName}:${tool.name}` as its registered name.
 * - Converts the JSON Schema `inputSchema` to a Zod schema for validation.
 * - Never requires local confirmation (MCP tools are external).
 * - Delegates execution to `callFn` using the **original** (unprefixed) tool
 *   name so the MCP server receives the name it expects.
 *
 * @returns A `ToolPlugin` on success, or `null` if the schema cannot be
 *          converted (a warning is logged and the caller should skip the tool).
 */
export function wrapMCPTool(
  serverName: string,
  tool: MCPToolDefinition,
  callFn: (name: string, args: Record<string, unknown>) => Promise<ToolResult>,
): ToolPlugin | null {
  let zodSchema;
  try {
    zodSchema = jsonSchemaToZod(tool.inputSchema);
  } catch (error: unknown) {
    if (error instanceof SchemaConversionError) {
      console.warn(
        `[MCP] Skipping tool "${serverName}:${tool.name}": schema conversion failed — ${error.message}`,
      );
      return null;
    }
    // Re-throw unexpected errors
    throw error;
  }

  const prefixedName = `${serverName}:${tool.name}`;

  const plugin: ToolPlugin = {
    name: prefixedName,
    description: tool.description,
    inputSchema: zodSchema,
    requiresConfirmation: () => false,
    async execute(args: unknown): Promise<ToolResult> {
      return callFn(tool.name, args as Record<string, unknown>);
    },
  };

  return plugin;
}
