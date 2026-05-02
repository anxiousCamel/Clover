/**
 * Tool plugin interfaces for Clover's tool registry.
 *
 * NOTE: The design doc specifies `inputSchema: z.ZodSchema` but shared types
 * must not depend on zod (backend-only dep). We use `unknown` here so each
 * backend plugin can narrow to its concrete Zod schema at the implementation
 * layer.
 */

/** Context provided to every tool execution. */
export interface ToolContext {
  workspacePath: string;
  sessionId: string;
  execGuard: ExecGuard;
  emitEvent: (type: string, data: unknown) => void;
}

/** Minimal contract for the exec-guard dependency injected into tools. */
export interface ExecGuard {
  execute: (
    command: string,
    options?: { cwd?: string; timeoutMs?: number },
  ) => Promise<ExecGuardResult>;
}

/** Result returned by ExecGuard.execute. */
export interface ExecGuardResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** A tool plugin that can be registered in the Tool Registry. */
export interface ToolPlugin {
  name: string;
  description: string;
  /** Zod schema at runtime — typed as `unknown` to avoid coupling shared to zod. */
  inputSchema: unknown;
  requiresConfirmation: (args: unknown) => boolean;
  execute: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

/** Result returned by a tool execution. */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}
