/**
 * MCP Connector — manages lifecycle of MCP server connections.
 *
 * Handles connecting to MCP servers via stdio (child process) or SSE
 * (HTTP Server-Sent Events) transport, discovering tools, registering
 * them in the ToolRegistry, and routing tool calls to the correct server.
 *
 * The `@modelcontextprotocol/sdk` package is loaded dynamically so the
 * module compiles even when the SDK is not installed. All SDK-dependent
 * code is isolated behind async helpers that perform the dynamic import.
 */

import { z } from 'zod';
import type { ToolResult, ToolPlugin } from '@clover/shared';
import type { MCPServerConfig } from '@clover/shared';
import {
  MCPConnectionError,
  MCPTimeoutError,
} from '../errors/mcp-errors.js';
import { wrapMCPTool, type MCPToolDefinition } from './tool-adapter.js';
import {
  registerExternal,
  unregisterByPrefix,
  getPlugin,
} from '../tools/tool-registry.js';

// ---------------------------------------------------------------------------
// Minimal SDK type stubs (avoids compile-time dependency on the SDK)
// ---------------------------------------------------------------------------

/**
 * Minimal interface matching `@modelcontextprotocol/sdk/client/index.js`
 * `Client` shape. Only the methods we actually call are declared.
 */
interface MCPClient {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<{ tools: MCPToolDefinition[] }>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<MCPCallToolResult>;
}

/** Shape returned by `client.callTool()`. */
export interface MCPCallToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// MCPServerHandle
// ---------------------------------------------------------------------------

export interface MCPServerHandle {
  name: string;
  client: MCPClient;
  transport: unknown;
  config: MCPServerConfig;
  status: 'connected' | 'disconnected' | 'error';
  tools: string[]; // registered tool names (prefixed)
  disconnect(): Promise<void>;
}

// ---------------------------------------------------------------------------
// MCPConnector interface
// ---------------------------------------------------------------------------

export interface IMCPConnector {
  connectAll(configs: MCPServerConfig[]): Promise<void>;
  callTool(
    prefixedName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult>;
  getStatus(): Map<string, MCPServerHandle['status']>;
  disconnectAll(): Promise<void>;
  isMCPTool(name: string): boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Dynamic SDK import helpers
// ---------------------------------------------------------------------------

// Module specifiers stored as variables so TypeScript does not attempt
// static resolution of the (potentially absent) MCP SDK package.
const SDK_CLIENT_MODULE = '@modelcontextprotocol/sdk/client/index.js';
const SDK_STDIO_MODULE = '@modelcontextprotocol/sdk/client/stdio.js';
const SDK_SSE_MODULE = '@modelcontextprotocol/sdk/client/sse.js';

/**
 * Dynamically import the MCP SDK Client class.
 * Throws `MCPConnectionError` if the SDK is not installed.
 */
async function loadSDKClient(): Promise<new (...args: unknown[]) => MCPClient> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod = await import(/* webpackIgnore: true */ SDK_CLIENT_MODULE);
    return mod.Client as unknown as new (...args: unknown[]) => MCPClient;
  } catch {
    throw new MCPConnectionError(
      '*',
      '@modelcontextprotocol/sdk is not installed. Run: npm install @modelcontextprotocol/sdk',
    );
  }
}

/**
 * Dynamically import the StdioClientTransport class.
 */
async function loadStdioTransport(): Promise<
  new (opts: { command: string; args?: string[]; env?: Record<string, string> }) => unknown
> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod = await import(/* webpackIgnore: true */ SDK_STDIO_MODULE);
    return mod.StdioClientTransport as unknown as new (opts: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }) => unknown;
  } catch {
    throw new MCPConnectionError(
      '*',
      '@modelcontextprotocol/sdk stdio transport is not available.',
    );
  }
}

/**
 * Dynamically import the SSEClientTransport class.
 */
async function loadSSETransport(): Promise<
  new (url: URL) => unknown
> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod = await import(/* webpackIgnore: true */ SDK_SSE_MODULE);
    return mod.SSEClientTransport as unknown as new (url: URL) => unknown;
  } catch {
    throw new MCPConnectionError(
      '*',
      '@modelcontextprotocol/sdk SSE transport is not available.',
    );
  }
}

// ---------------------------------------------------------------------------
// convertMCPResult — standalone, exported for testability
// ---------------------------------------------------------------------------

/**
 * Convert an MCP `callTool` result into Clover's standard `ToolResult` shape.
 *
 * - Success responses (`isError` falsy) → `{ success: true, output }`.
 * - Error responses (`isError` truthy) → `{ success: false, output: '', error }`.
 *
 * Text content parts are joined with newlines.
 */
export function convertMCPResult(result: MCPCallToolResult): ToolResult {
  const textParts = result.content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text as string);

  const output = textParts.join('\n');

  if (result.isError) {
    return {
      success: false,
      output: '',
      error: output || 'MCP tool returned an error with no message.',
    };
  }

  return {
    success: true,
    output,
  };
}

// ---------------------------------------------------------------------------
// MCPConnector implementation
// ---------------------------------------------------------------------------

export class MCPConnector implements IMCPConnector {
  private servers = new Map<string, MCPServerHandle>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // -----------------------------------------------------------------------
  // connectAll
  // -----------------------------------------------------------------------

  /**
   * Connect to all configured MCP servers. Each server is connected in its
   * own error boundary — a failure in one server logs the error and
   * continues to the next.
   */
  async connectAll(configs: MCPServerConfig[]): Promise<void> {
    for (const config of configs) {
      try {
        await this.connectServer(config);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[MCP] Failed to connect to server "${config.name}": ${message}`,
        );
        // Record the server as errored so getStatus() reports it
        this.servers.set(config.name, {
          name: config.name,
          client: null as unknown as MCPClient,
          transport: null,
          config,
          status: 'error',
          tools: [],
          disconnect: async () => {},
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // callTool
  // -----------------------------------------------------------------------

  /**
   * Execute a tool on its originating MCP server.
   *
   * 1. Parse the prefixed name (`serverName:toolName`) to find the server.
   * 2. Validate args against the tool's Zod schema (via the ToolPlugin).
   * 3. Call the MCP server with a configurable timeout.
   * 4. Convert the MCP result to Clover's `ToolResult` format.
   */
  async callTool(
    prefixedName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const { serverName, toolName } = this.parsePrefixedName(prefixedName);

    const handle = this.servers.get(serverName);
    if (!handle || handle.status !== 'connected') {
      return {
        success: false,
        output: '',
        error: `MCP server "${serverName}" is not connected.`,
      };
    }

    // Validate args against the registered Zod schema
    const plugin = getPlugin(prefixedName);
    if (plugin) {
      const schema = plugin.inputSchema;
      if (schema instanceof z.ZodType) {
        const result = schema.safeParse(args);
        if (!result.success) {
          const summary = result.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
          return {
            success: false,
            output: '',
            error: `Validation failed for tool "${prefixedName}": ${summary}`,
          };
        }
        args = result.data as Record<string, unknown>;
      }
    }

    // Execute with timeout
    const timeoutMs = handle.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      const result = await this.callWithTimeout(
        handle,
        toolName,
        args,
        timeoutMs,
      );
      return this.convertResult(result);
    } catch (error: unknown) {
      if (error instanceof MCPTimeoutError) {
        return {
          success: false,
          output: '',
          error: error.message,
        };
      }
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: '',
        error: `MCP tool "${prefixedName}" execution failed: ${message}`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // getStatus
  // -----------------------------------------------------------------------

  /**
   * Return the connection status of every known MCP server.
   */
  getStatus(): Map<string, MCPServerHandle['status']> {
    const statusMap = new Map<string, MCPServerHandle['status']>();
    for (const [name, handle] of this.servers) {
      statusMap.set(name, handle.status);
    }
    return statusMap;
  }

  // -----------------------------------------------------------------------
  // disconnectAll
  // -----------------------------------------------------------------------

  /**
   * Graceful shutdown — close all connections and kill child processes.
   */
  async disconnectAll(): Promise<void> {
    // Clear all reconnect timers
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // Disconnect each server in its own error boundary
    const disconnectPromises = [...this.servers.values()].map(
      async (handle) => {
        try {
          await handle.disconnect();
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(
            `[MCP] Error disconnecting server "${handle.name}": ${message}`,
          );
        }
      },
    );

    await Promise.allSettled(disconnectPromises);
    this.servers.clear();
  }

  // -----------------------------------------------------------------------
  // isMCPTool
  // -----------------------------------------------------------------------

  /**
   * Check if a tool name belongs to an MCP server.
   */
  isMCPTool(name: string): boolean {
    for (const handle of this.servers.values()) {
      if (handle.tools.includes(name)) {
        return true;
      }
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Private: connectServer
  // -----------------------------------------------------------------------

  /**
   * Connect to a single MCP server, discover its tools, and register them.
   */
  private async connectServer(config: MCPServerConfig): Promise<void> {
    const ClientClass = await loadSDKClient();

    // Create the transport based on config
    const transport = await this.createTransport(config);

    // Create the MCP client and connect
    const client = new ClientClass({
      name: `clover-${config.name}`,
      version: '1.0.0',
    }) as MCPClient;

    await client.connect(transport);

    // Build the handle (tools populated after discovery)
    const handle: MCPServerHandle = {
      name: config.name,
      client,
      transport,
      config,
      status: 'connected',
      tools: [],
      disconnect: async () => {
        try {
          await client.close();
        } catch {
          // Best-effort close
        }
        handle.status = 'disconnected';
        unregisterByPrefix(config.name);
      },
    };

    this.servers.set(config.name, handle);

    // Discover and register tools
    await this.discoverTools(handle);

    console.log(
      `[MCP] Connected to server "${config.name}" — ${handle.tools.length} tool(s) registered.`,
    );
  }

  // -----------------------------------------------------------------------
  // Private: createTransport
  // -----------------------------------------------------------------------

  /**
   * Create the appropriate transport (stdio or SSE) for a server config.
   */
  private async createTransport(config: MCPServerConfig): Promise<unknown> {
    if (config.transport === 'stdio') {
      if (!config.command) {
        throw new MCPConnectionError(
          config.name,
          'stdio transport requires a "command" field.',
        );
      }

      const StdioTransport = await loadStdioTransport();

      // Build environment with auth token if provided
      const env: Record<string, string> = { ...process.env } as Record<
        string,
        string
      >;
      if (config.auth?.token) {
        env['MCP_AUTH_TOKEN'] = config.auth.token;
      }

      return new StdioTransport({
        command: config.command,
        args: config.args,
        env,
      });
    }

    if (config.transport === 'sse') {
      if (!config.url) {
        throw new MCPConnectionError(
          config.name,
          'sse transport requires a "url" field.',
        );
      }

      const SSETransport = await loadSSETransport();
      const url = new URL(config.url);

      // Pass auth token as query parameter or header depending on SDK
      if (config.auth?.token) {
        url.searchParams.set('token', config.auth.token);
      }

      return new SSETransport(url);
    }

    throw new MCPConnectionError(
      config.name,
      `Unsupported transport type: "${config.transport}"`,
    );
  }

  // -----------------------------------------------------------------------
  // Private: discoverTools
  // -----------------------------------------------------------------------

  /**
   * Call `tools/list` on the MCP server, convert each tool to a ToolPlugin,
   * and register it in the ToolRegistry.
   */
  private async discoverTools(handle: MCPServerHandle): Promise<void> {
    const { tools } = await handle.client.listTools();

    const callFn = async (
      toolName: string,
      args: Record<string, unknown>,
    ): Promise<ToolResult> => {
      return this.callTool(`${handle.name}:${toolName}`, args);
    };

    const registeredNames: string[] = [];

    for (const tool of tools) {
      const plugin: ToolPlugin | null = wrapMCPTool(
        handle.name,
        tool,
        callFn,
      );

      if (plugin) {
        registerExternal(plugin);
        registeredNames.push(plugin.name);
      }
    }

    handle.tools = registeredNames;
  }

  // -----------------------------------------------------------------------
  // Private: callWithTimeout
  // -----------------------------------------------------------------------

  /**
   * Call an MCP tool with a timeout. Throws `MCPTimeoutError` if the
   * call exceeds the configured duration.
   */
  private async callWithTimeout(
    handle: MCPServerHandle,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<MCPCallToolResult> {
    return new Promise<MCPCallToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new MCPTimeoutError(handle.name, toolName, timeoutMs),
        );
      }, timeoutMs);

      handle.client
        .callTool({ name: toolName, arguments: args })
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  // -----------------------------------------------------------------------
  // Private: convertResult
  // -----------------------------------------------------------------------

  /**
   * Convert an MCP `callTool` result to Clover's `ToolResult` format.
   *
   * - Success: `{ success: true, output: <text content joined> }`
   * - Error:   `{ success: false, output: '', error: <text content joined> }`
   */
  private convertResult(result: MCPCallToolResult): ToolResult {
    return convertMCPResult(result);
  }

  // -----------------------------------------------------------------------
  // Private: parsePrefixedName
  // -----------------------------------------------------------------------

  /**
   * Parse a prefixed tool name (`serverName:toolName`) into its components.
   */
  private parsePrefixedName(prefixedName: string): {
    serverName: string;
    toolName: string;
  } {
    const colonIndex = prefixedName.indexOf(':');
    if (colonIndex === -1) {
      return { serverName: '', toolName: prefixedName };
    }
    return {
      serverName: prefixedName.slice(0, colonIndex),
      toolName: prefixedName.slice(colonIndex + 1),
    };
  }

  // -----------------------------------------------------------------------
  // Private: handleDisconnect
  // -----------------------------------------------------------------------

  /**
   * Handle a server disconnect: mark tools unavailable and schedule
   * reconnection attempts.
   */
  handleDisconnect(serverName: string, reason?: string): void {
    const handle = this.servers.get(serverName);
    if (!handle) return;

    handle.status = 'disconnected';
    unregisterByPrefix(serverName);

    console.warn(
      `[MCP] Server "${serverName}" disconnected${reason ? `: ${reason}` : ''}. Tools removed.`,
    );

    // Schedule reconnection
    this.scheduleReconnect(handle, 0);
  }

  // -----------------------------------------------------------------------
  // Private: scheduleReconnect
  // -----------------------------------------------------------------------

  /**
   * Attempt to reconnect to a disconnected server with exponential backoff.
   */
  private scheduleReconnect(
    handle: MCPServerHandle,
    attempt: number,
  ): void {
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      handle.status = 'error';
      console.error(
        `[MCP] Server "${handle.name}" — max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached.`,
      );
      return;
    }

    const delay = RECONNECT_DELAY_MS * Math.pow(2, attempt);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(handle.name);

      try {
        console.log(
          `[MCP] Attempting reconnect to "${handle.name}" (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})...`,
        );

        // Remove old handle and reconnect
        this.servers.delete(handle.name);
        await this.connectServer(handle.config);

        console.log(
          `[MCP] Successfully reconnected to "${handle.name}".`,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[MCP] Reconnect to "${handle.name}" failed: ${message}`,
        );
        // Re-register the handle as disconnected and try again
        const current = this.servers.get(handle.name);
        if (current) {
          current.status = 'disconnected';
        }
        this.scheduleReconnect(handle, attempt + 1);
      }
    }, delay);

    this.reconnectTimers.set(handle.name, timer);
  }
}
