/**
 * Execution Router — the Tool Forcing Layer.
 *
 * The LLM does NOT decide whether to use a tool.
 * If intent maps to a known tool, that tool is executed unconditionally.
 * Returns a PipelineDecision so the engine can perform the actual execution.
 *
 * @module pipeline/execution.router
 */

import type { IntentLabel, ExtractedParams, PipelineDecision, ClassifyResult } from './intent.types.js';
import { pipelineLog } from './pipeline.logger.js';

// ---------------------------------------------------------------------------
// Intent → tool name mapping (single source of truth)
// ---------------------------------------------------------------------------

const INTENT_TO_TOOL: Partial<Record<IntentLabel, string>> = {
  write_file: 'write-file',
  read_file: 'read-file',
  list_files: 'list-files',
  delete_file: 'delete-file',
  execute_command: 'execute-command',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Route a classified intent to a forced tool execution or chat fallback.
 *
 * Returns:
 * - mode='execute' + toolName + toolArgs  → engine must call the tool
 * - mode='chat'                           → engine uses normal agent dispatch
 */
export function routeExecution(
  extracted: ExtractedParams,
  classify: ClassifyResult,
  sessionId: string,
): PipelineDecision {
  const toolName = INTENT_TO_TOOL[extracted.intent];

  // No matching tool → fall through to chat/agent
  if (!toolName || extracted.params === null) {
    pipelineLog({
      event: 'route:chat',
      sessionId,
      data: { intent: extracted.intent, reason: 'no_tool_mapping' },
    });
    return { mode: 'chat', classify };
  }

  // Build tool args from extracted params
  const toolArgs = buildToolArgs(extracted);

  pipelineLog({
    event: 'route:execute',
    sessionId,
    data: { intent: extracted.intent, tool: toolName, args: toolArgs },
  });

  return {
    mode: 'execute',
    toolName,
    toolArgs,
    classify,
  };
}

/** Map extracted params to the flat args object expected by each tool plugin. */
function buildToolArgs(extracted: ExtractedParams): Record<string, unknown> {
  switch (extracted.intent) {
    case 'write_file':
      return { path: extracted.params.path, content: extracted.params.content };

    case 'read_file':
      return { path: extracted.params.path };

    case 'list_files':
      return { path: extracted.params.path, depth: extracted.params.depth };

    case 'delete_file':
      return { path: extracted.params.path };

    case 'execute_command':
      return {
        command: extracted.params.command,
        ...(extracted.params.cwd ? { cwd: extracted.params.cwd } : {}),
      };

    default:
      return {};
  }
}
