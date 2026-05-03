/**
 * Property-Based Test — Property 4: MCP Tool Name Prefixing and Server Association
 *
 * **Validates: Requirements 1.3.4, 1.3.6**
 *
 * For any MCP server name and for any tool name discovered from that server,
 * the registered tool name SHALL equal `${serverName}:${toolName}`, and
 * looking up the tool's originating server SHALL return the original server name.
 *
 * Generator strategy:
 *   - Generate random alphanumeric server names and tool names.
 *   - Wrap via wrapMCPTool, register via registerExternal.
 *   - Verify prefixed name, isExternal flag, and server association via prefix.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { wrapMCPTool } from '../tool-adapter.js';
import type { MCPToolDefinition } from '../tool-adapter.js';
import {
  registerExternal,
  isExternal,
  listTools,
  unregisterByPrefix,
  getPlugin,
} from '../../tools/tool-registry.js';
import type { ToolResult } from '@clover/shared';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generate valid server names: alphanumeric, starting with a letter, 1–15 chars.
 * Avoids colons to prevent ambiguity in the prefixed name format.
 */
const serverNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,14}$/);

/**
 * Generate valid tool names: alphanumeric with hyphens/underscores, 1–20 chars.
 * Mirrors typical MCP tool naming conventions (e.g., "create_issue", "list-repos").
 */
const toolNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,19}$/);

/**
 * A minimal valid JSON Schema for the tool's inputSchema.
 * We use a simple object schema since the focus is on name prefixing, not schema conversion.
 */
const minimalInputSchema = {
  type: 'object',
  properties: {},
  required: [],
};

/**
 * Stub callFn that returns a success result — not exercised in these tests
 * but required by the wrapMCPTool signature.
 */
const stubCallFn = async (_name: string, _args: Record<string, unknown>): Promise<ToolResult> => ({
  success: true,
  output: 'stub',
});

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

/**
 * Track registered prefixes so we can clean up after each test run
 * to avoid polluting the global ToolRegistry state.
 */
let registeredPrefixes: Set<string>;

beforeEach(() => {
  registeredPrefixes = new Set<string>();
});

function cleanupRegistry() {
  for (const prefix of registeredPrefixes) {
    unregisterByPrefix(prefix);
  }
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 4: MCP Tool Name Prefixing and Server Association', () => {
  it('registered tool name equals ${serverName}:${toolName} (Req 1.3.4)', () => {
    fc.assert(
      fc.property(serverNameArb, toolNameArb, (serverName, toolName) => {
        const toolDef: MCPToolDefinition = {
          name: toolName,
          description: `Test tool ${toolName}`,
          inputSchema: minimalInputSchema,
        };

        const plugin = wrapMCPTool(serverName, toolDef, stubCallFn);
        expect(plugin).not.toBeNull();

        const expectedName = `${serverName}:${toolName}`;
        expect(plugin!.name).toBe(expectedName);

        // Register and verify it appears in the registry
        registerExternal(plugin!);
        registeredPrefixes.add(serverName);

        expect(listTools()).toContain(expectedName);

        // Cleanup for next iteration
        cleanupRegistry();
        registeredPrefixes.clear();
      }),
      { numRuns: 100 },
    );
  });

  it('looking up the tool originating server returns the original server name (Req 1.3.6)', () => {
    fc.assert(
      fc.property(serverNameArb, toolNameArb, (serverName, toolName) => {
        const toolDef: MCPToolDefinition = {
          name: toolName,
          description: `Test tool ${toolName}`,
          inputSchema: minimalInputSchema,
        };

        const plugin = wrapMCPTool(serverName, toolDef, stubCallFn);
        expect(plugin).not.toBeNull();

        registerExternal(plugin!);
        registeredPrefixes.add(serverName);

        const prefixedName = plugin!.name;

        // Extract server name from the prefixed tool name by splitting on ':'
        const colonIndex = prefixedName.indexOf(':');
        expect(colonIndex).toBeGreaterThan(0);

        const extractedServerName = prefixedName.substring(0, colonIndex);
        expect(extractedServerName).toBe(serverName);

        // The original tool name is recoverable from the suffix
        const extractedToolName = prefixedName.substring(colonIndex + 1);
        expect(extractedToolName).toBe(toolName);

        // Cleanup for next iteration
        cleanupRegistry();
        registeredPrefixes.clear();
      }),
      { numRuns: 100 },
    );
  });

  it('registered tool is correctly identified as external (Req 1.3.6)', () => {
    fc.assert(
      fc.property(serverNameArb, toolNameArb, (serverName, toolName) => {
        const toolDef: MCPToolDefinition = {
          name: toolName,
          description: `Test tool ${toolName}`,
          inputSchema: minimalInputSchema,
        };

        const plugin = wrapMCPTool(serverName, toolDef, stubCallFn);
        expect(plugin).not.toBeNull();

        const prefixedName = plugin!.name;

        registerExternal(plugin!);
        registeredPrefixes.add(serverName);

        // The tool should be identified as external
        expect(isExternal(prefixedName)).toBe(true);

        // After unregistering by prefix, it should no longer be external
        unregisterByPrefix(serverName);
        expect(isExternal(prefixedName)).toBe(false);
        expect(listTools()).not.toContain(prefixedName);

        registeredPrefixes.clear();
      }),
      { numRuns: 100 },
    );
  });

  it('multiple tools from the same server all share the server prefix (Req 1.3.4, 1.3.6)', () => {
    fc.assert(
      fc.property(
        serverNameArb,
        fc.array(toolNameArb, { minLength: 1, maxLength: 5 }),
        (serverName, toolNames) => {
          // Deduplicate tool names
          const uniqueToolNames = [...new Set(toolNames)];

          const plugins = uniqueToolNames.map((tn) => {
            const toolDef: MCPToolDefinition = {
              name: tn,
              description: `Test tool ${tn}`,
              inputSchema: minimalInputSchema,
            };
            return wrapMCPTool(serverName, toolDef, stubCallFn);
          });

          // All plugins should be non-null
          for (const p of plugins) {
            expect(p).not.toBeNull();
          }

          // Register all
          for (const p of plugins) {
            registerExternal(p!);
          }
          registeredPrefixes.add(serverName);

          // Verify each tool has the correct prefix and is external
          for (let i = 0; i < uniqueToolNames.length; i++) {
            const expectedName = `${serverName}:${uniqueToolNames[i]}`;
            expect(plugins[i]!.name).toBe(expectedName);
            expect(isExternal(expectedName)).toBe(true);

            // Server lookup via prefix extraction
            const colonIdx = plugins[i]!.name.indexOf(':');
            expect(plugins[i]!.name.substring(0, colonIdx)).toBe(serverName);
          }

          // Unregistering by prefix removes all tools from that server
          unregisterByPrefix(serverName);
          for (const tn of uniqueToolNames) {
            const prefixed = `${serverName}:${tn}`;
            expect(isExternal(prefixed)).toBe(false);
            expect(listTools()).not.toContain(prefixed);
          }

          registeredPrefixes.clear();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('the plugin is retrievable from the registry after registration (Req 1.3.6)', () => {
    fc.assert(
      fc.property(serverNameArb, toolNameArb, (serverName, toolName) => {
        const toolDef: MCPToolDefinition = {
          name: toolName,
          description: `Test tool ${toolName}`,
          inputSchema: minimalInputSchema,
        };

        const plugin = wrapMCPTool(serverName, toolDef, stubCallFn);
        expect(plugin).not.toBeNull();

        registerExternal(plugin!);
        registeredPrefixes.add(serverName);

        const prefixedName = `${serverName}:${toolName}`;

        // The plugin should be retrievable by its prefixed name
        const retrieved = getPlugin(prefixedName);
        expect(retrieved).toBeDefined();
        expect(retrieved!.name).toBe(prefixedName);
        expect(retrieved!.description).toBe(`Test tool ${toolName}`);

        // Cleanup
        cleanupRegistry();
        registeredPrefixes.clear();
      }),
      { numRuns: 100 },
    );
  });
});
