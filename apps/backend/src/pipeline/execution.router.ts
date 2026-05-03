/**
 * Execution Router — the Tool Forcing Layer with Safe Execution Guard.
 *
 * The LLM does NOT decide whether to use a tool.
 * If intent maps to a known tool, that tool is executed unconditionally
 * AFTER passing validation checks.
 *
 * Validation layer (before any execution):
 *   1. Confidence threshold — reject low-confidence classifications
 *   2. Path validation — verify file vs directory, existence
 *   3. Argument completeness — no undefined/empty required args
 *
 * @module pipeline/execution.router
 */

import type { IntentLabel, ExtractedParams, PipelineDecision, ClassifyResult } from './intent.types.js';
import { validatePath } from './param.extractor.js';
import { pipelineLog } from './pipeline.logger.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Minimum confidence to proceed with tool execution. */
const MIN_CONFIDENCE = 0.5;

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
// Validation
// ---------------------------------------------------------------------------

interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate extracted params before tool execution.
 * Returns { valid: false, error } if execution should be blocked.
 */
function validateBeforeExecution(
  extracted: ExtractedParams,
  classify: ClassifyResult,
): ValidationResult {
  // 1. Confidence threshold
  if (classify.confidence < MIN_CONFIDENCE) {
    return {
      valid: false,
      error: `Low confidence (${classify.confidence}) for intent "${extracted.intent}"`,
    };
  }

  // 2. Null params check
  if (extracted.params === null) {
    return { valid: false, error: 'No parameters extracted' };
  }

  // 3. Path validation for file operations
  if (
    extracted.intent === 'write_file' ||
    extracted.intent === 'read_file' ||
    extracted.intent === 'list_files' ||
    extracted.intent === 'delete_file'
  ) {
    const filePath = (extracted.params as { path: string }).path;

    // Empty or undefined path
    if (!filePath || filePath.trim() === '') {
      return { valid: false, error: 'Empty file path' };
    }

    // Validate path type (file vs directory) and existence
    const pathCheck = validatePath(filePath, extracted.intent);
    if (!pathCheck.valid) {
      return { valid: false, error: pathCheck.error };
    }
  }

  // 4. Command validation for execute_command
  if (extracted.intent === 'execute_command') {
    const cmd = (extracted.params as { command: string }).command;
    if (!cmd || cmd.trim() === '') {
      return { valid: false, error: 'Empty command' };
    }
  }

  // 5. Write content validation
  if (extracted.intent === 'write_file') {
    const content = (extracted.params as { content: string }).content;
    if (content === undefined || content === null) {
      return { valid: false, error: 'No content to write' };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Route a classified intent to a forced tool execution or chat fallback.
 *
 * Returns:
 * - mode='execute' + toolName + toolArgs  → engine must call the tool
 * - mode='chat'                           → engine uses normal agent dispatch
 * - mode='chat' + error in log            → validation failed, safe fallback
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

  // Validate before execution
  const validation = validateBeforeExecution(extracted, classify);
  if (!validation.valid) {
    pipelineLog({
      event: 'route:chat',
      sessionId,
      data: {
        intent: extracted.intent,
        reason: 'validation_failed',
        error: validation.error,
        confidence: classify.confidence,
      },
    });
    // Return chat mode with the validation error — the agent can inform the user
    return {
      mode: 'chat',
      classify: {
        ...classify,
        // Override confidence to signal this was a blocked execution
        confidence: 0,
      },
      validationError: validation.error,
    };
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
