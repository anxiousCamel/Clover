/**
 * MCP-related error classes for connection, timeout, disconnect,
 * and schema conversion failures.
 */

// ---------------------------------------------------------------------------
// MCPConnectionError
// ---------------------------------------------------------------------------

export class MCPConnectionError extends Error {
  public readonly serverName: string;

  constructor(serverName: string, reason: string) {
    super(
      `Failed to connect to MCP server "${serverName}": ${reason}`,
    );
    this.name = 'MCPConnectionError';
    this.serverName = serverName;
  }
}

// ---------------------------------------------------------------------------
// MCPTimeoutError
// ---------------------------------------------------------------------------

export class MCPTimeoutError extends Error {
  public readonly serverName: string;
  public readonly toolName: string;
  public readonly timeoutMs: number;

  constructor(serverName: string, toolName: string, timeoutMs: number) {
    super(
      `MCP tool "${serverName}:${toolName}" timed out after ${timeoutMs}ms`,
    );
    this.name = 'MCPTimeoutError';
    this.serverName = serverName;
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
}

// ---------------------------------------------------------------------------
// MCPDisconnectError
// ---------------------------------------------------------------------------

export class MCPDisconnectError extends Error {
  public readonly serverName: string;

  constructor(serverName: string, reason?: string) {
    const message = reason
      ? `MCP server "${serverName}" disconnected: ${reason}`
      : `MCP server "${serverName}" disconnected unexpectedly`;
    super(message);
    this.name = 'MCPDisconnectError';
    this.serverName = serverName;
  }
}

// ---------------------------------------------------------------------------
// SchemaConversionError
// ---------------------------------------------------------------------------

export class SchemaConversionError extends Error {
  public readonly serverName: string;
  public readonly toolName: string;

  constructor(serverName: string, toolName: string, reason: string) {
    super(
      `Failed to convert schema for tool "${serverName}:${toolName}": ${reason}`,
    );
    this.name = 'SchemaConversionError';
    this.serverName = serverName;
    this.toolName = toolName;
  }
}
