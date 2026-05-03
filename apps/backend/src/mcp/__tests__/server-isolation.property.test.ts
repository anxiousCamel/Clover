/**
 * Property-Based Test — Property 6: MCP Server Isolation on Disconnect
 *
 * **Validates: Requirements 1.6.1, 1.6.2, 1.6.3**
 *
 * For any set of N connected MCP servers (N ≥ 2), when one server disconnects,
 * the tools from remaining connected servers SHALL still appear in `listTools()`
 * output, and only the disconnected server's tools SHALL be excluded.
 *
 * Generator strategy:
 *   - Generate 2–5 server configs, each with 1–4 unique tool names.
 *   - Register all tools from all servers via `registerExternal`.
 *   - Disconnect a random non-empty proper subset of servers via `unregisterByPrefix`.
 *   - Verify remaining servers' tools are still listed.
 *   - Verify disconnected servers' tools are no longer listed.
 *   - Verify `isExternal` reflects the correct state for both sets.
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
} from '../../tools/tool-registry.js';
import type { ToolResult } from '@clover/shared';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generate valid server names: alphanumeric, starting with a letter, 2–10 chars.
 * Avoids colons to prevent ambiguity in the prefixed name format.
 */
const serverNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{1,9}$/);

/**
 * Generate valid tool names: alphanumeric with hyphens/underscores, 2–15 chars.
 */
const toolNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{1,14}$/);

/**
 * A minimal valid JSON Schema for tool inputSchema.
 * Focus is on isolation behavior, not schema conversion.
 */
const minimalInputSchema = {
  type: 'object',
  properties: {},
  required: [],
};

/**
 * Stub callFn — not exercised in these tests but required by wrapMCPTool.
 */
const stubCallFn = async (_name: string, _args: Record<string, unknown>): Promise<ToolResult> => ({
  success: true,
  output: 'stub',
});

/**
 * Generate a single server config: a unique server name with 1–4 unique tool names.
 */
const serverWithToolsArb = fc
  .tuple(
    serverNameArb,
    fc.uniqueArray(toolNameArb, { minLength: 1, maxLength: 4 }),
  )
  .map(([name, tools]) => ({ name, tools }));

/**
 * Generate 2–5 servers, each with unique server names and unique tool names.
 * We ensure server names are unique across the set.
 */
const serverSetArb = fc
  .uniqueArray(serverWithToolsArb, {
    minLength: 2,
    maxLength: 5,
    selector: (s) => s.name,
  })
  .filter((servers) => servers.length >= 2);

/**
 * Generate a server set together with a non-empty proper subset of indices
 * to disconnect. At least one server stays connected, at least one disconnects.
 */
const serverSetWithDisconnectArb = serverSetArb.chain((servers) => {
  const n = servers.length;
  // Generate a non-empty proper subset of indices to disconnect
  return fc
    .uniqueArray(fc.integer({ min: 0, max: n - 1 }), {
      minLength: 1,
      maxLength: n - 1,
    })
    .map((disconnectIndices) => ({
      servers,
      disconnectIndices: new Set(disconnectIndices),
    }));
});

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

let registeredPrefixes: Set<string>;

beforeEach(() => {
  registeredPrefixes = new Set<string>();
});

function cleanupRegistry() {
  for (const prefix of registeredPrefixes) {
    unregisterByPrefix(prefix);
  }
  registeredPrefixes.clear();
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 6: MCP Server Isolation on Disconnect', () => {
  it('disconnecting a subset of servers removes only their tools from listTools() (Req 1.6.1, 1.6.2)', () => {
    fc.assert(
      fc.property(serverSetWithDisconnectArb, ({ servers, disconnectIndices }) => {
        // --- Setup: register all tools from all servers ---
        const allPrefixedNames: Map<string, string[]> = new Map();

        for (const server of servers) {
          const prefixedNames: string[] = [];
          for (const toolName of server.tools) {
            const toolDef: MCPToolDefinition = {
              name: toolName,
              description: `Tool ${toolName} from ${server.name}`,
              inputSchema: minimalInputSchema,
            };
            const plugin = wrapMCPTool(server.name, toolDef, stubCallFn);
            expect(plugin).not.toBeNull();
            registerExternal(plugin!);
            prefixedNames.push(plugin!.name);
          }
          allPrefixedNames.set(server.name, prefixedNames);
          registeredPrefixes.add(server.name);
        }

        // Verify all tools are initially listed
        const toolsBefore = listTools();
        for (const [, names] of allPrefixedNames) {
          for (const name of names) {
            expect(toolsBefore).toContain(name);
          }
        }

        // --- Act: disconnect the random subset ---
        const disconnectedServers: string[] = [];
        const remainingServers: string[] = [];

        for (let i = 0; i < servers.length; i++) {
          if (disconnectIndices.has(i)) {
            disconnectedServers.push(servers[i].name);
            unregisterByPrefix(servers[i].name);
          } else {
            remainingServers.push(servers[i].name);
          }
        }

        // --- Assert: remaining tools still listed ---
        const toolsAfter = listTools();

        for (const serverName of remainingServers) {
          const names = allPrefixedNames.get(serverName)!;
          for (const name of names) {
            expect(toolsAfter).toContain(name);
          }
        }

        // --- Assert: disconnected tools are excluded ---
        for (const serverName of disconnectedServers) {
          const names = allPrefixedNames.get(serverName)!;
          for (const name of names) {
            expect(toolsAfter).not.toContain(name);
          }
        }

        // Cleanup for next iteration
        cleanupRegistry();
      }),
      { numRuns: 100 },
    );
  });

  it('isExternal returns false for disconnected tools and true for remaining tools (Req 1.6.1, 1.6.2)', () => {
    fc.assert(
      fc.property(serverSetWithDisconnectArb, ({ servers, disconnectIndices }) => {
        // --- Setup: register all tools ---
        const allPrefixedNames: Map<string, string[]> = new Map();

        for (const server of servers) {
          const prefixedNames: string[] = [];
          for (const toolName of server.tools) {
            const toolDef: MCPToolDefinition = {
              name: toolName,
              description: `Tool ${toolName} from ${server.name}`,
              inputSchema: minimalInputSchema,
            };
            const plugin = wrapMCPTool(server.name, toolDef, stubCallFn);
            expect(plugin).not.toBeNull();
            registerExternal(plugin!);
            prefixedNames.push(plugin!.name);
          }
          allPrefixedNames.set(server.name, prefixedNames);
          registeredPrefixes.add(server.name);
        }

        // --- Act: disconnect the random subset ---
        const disconnectedServers: string[] = [];
        const remainingServers: string[] = [];

        for (let i = 0; i < servers.length; i++) {
          if (disconnectIndices.has(i)) {
            disconnectedServers.push(servers[i].name);
            unregisterByPrefix(servers[i].name);
          } else {
            remainingServers.push(servers[i].name);
          }
        }

        // --- Assert: isExternal reflects correct state ---
        for (const serverName of remainingServers) {
          for (const name of allPrefixedNames.get(serverName)!) {
            expect(isExternal(name)).toBe(true);
          }
        }

        for (const serverName of disconnectedServers) {
          for (const name of allPrefixedNames.get(serverName)!) {
            expect(isExternal(name)).toBe(false);
          }
        }

        // Cleanup
        cleanupRegistry();
      }),
      { numRuns: 100 },
    );
  });

  it('disconnecting one server does not affect tool count of other servers (Req 1.6.3)', () => {
    fc.assert(
      fc.property(serverSetWithDisconnectArb, ({ servers, disconnectIndices }) => {
        // --- Setup: register all tools ---
        const allPrefixedNames: Map<string, string[]> = new Map();

        for (const server of servers) {
          const prefixedNames: string[] = [];
          for (const toolName of server.tools) {
            const toolDef: MCPToolDefinition = {
              name: toolName,
              description: `Tool ${toolName} from ${server.name}`,
              inputSchema: minimalInputSchema,
            };
            const plugin = wrapMCPTool(server.name, toolDef, stubCallFn);
            expect(plugin).not.toBeNull();
            registerExternal(plugin!);
            prefixedNames.push(plugin!.name);
          }
          allPrefixedNames.set(server.name, prefixedNames);
          registeredPrefixes.add(server.name);
        }

        // Record tool counts per remaining server before disconnect
        const remainingServers: string[] = [];
        for (let i = 0; i < servers.length; i++) {
          if (!disconnectIndices.has(i)) {
            remainingServers.push(servers[i].name);
          }
        }

        const expectedToolCounts = new Map<string, number>();
        for (const serverName of remainingServers) {
          expectedToolCounts.set(serverName, allPrefixedNames.get(serverName)!.length);
        }

        // --- Act: disconnect the subset ---
        for (let i = 0; i < servers.length; i++) {
          if (disconnectIndices.has(i)) {
            unregisterByPrefix(servers[i].name);
          }
        }

        // --- Assert: remaining servers still have the same number of tools ---
        const toolsAfter = listTools();
        for (const serverName of remainingServers) {
          const serverTools = allPrefixedNames.get(serverName)!;
          const listedCount = serverTools.filter((t) => toolsAfter.includes(t)).length;
          expect(listedCount).toBe(expectedToolCounts.get(serverName));
        }

        // Cleanup
        cleanupRegistry();
      }),
      { numRuns: 100 },
    );
  });
});
