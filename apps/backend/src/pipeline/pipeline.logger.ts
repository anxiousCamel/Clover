/**
 * Pipeline Logger — structured JSONL logging.
 *
 * Writes to stderr (prefixed) + .clover/logs/pipeline.jsonl.
 * File logging failures are silently swallowed (non-critical).
 *
 * @module pipeline/pipeline.logger
 */

import fs from 'node:fs';
import path from 'node:path';

export type PipelineEventType =
  | 'gate:pass'
  | 'gate:block'
  | 'classify:cache_hit'
  | 'classify:llm'
  | 'classify:context'
  | 'classify:error'
  | 'extract:done'
  | 'extract:error'
  | 'route:execute'
  | 'route:chat'
  | 'pipeline:error';

export interface PipelineLogEvent {
  event: PipelineEventType;
  sessionId: string;
  input?: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
}

let logFilePath: string | null = null;

/** Initialise file logging. Call once at boot with the project root dir. */
export function initPipelineLogger(baseDir: string): void {
  try {
    const logsDir = path.join(baseDir, '.clover', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    logFilePath = path.join(logsDir, 'pipeline.jsonl');
  } catch {
    logFilePath = null;
  }
}

/** Emit a structured log event to stderr and optionally a JSONL file. */
export function pipelineLog(event: PipelineLogEvent): void {
  const entry = {
    ts: new Date().toISOString(),
    ...event,
    input: event.input ? event.input.slice(0, 120) : undefined,
  };

  // Color-coded stderr: green for executions, gray for everything else
  if (process.env['CLOVER_DEBUG'] === 'true') {
    const color = event.event === 'route:execute' ? '\x1b[32m' : '\x1b[90m';
    process.stderr.write(
      `${color}[pipeline] ${event.event}${event.data ? ' ' + JSON.stringify(event.data) : ''}\x1b[0m\n`,
    );
  }

  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, JSON.stringify(entry) + '\n');
    } catch {
      // Non-critical — continue without file logging
    }
  }
}
