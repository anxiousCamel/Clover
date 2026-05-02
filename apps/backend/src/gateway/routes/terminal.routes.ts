/**
 * Terminal Routes — Fastify plugin that registers endpoints for creating
 * and terminating interactive terminal sessions, plus WebSocket event
 * wiring for real-time terminal I/O.
 *
 * Endpoints:
 * - `POST /terminal/sessions`       → create a new terminal session
 * - `DELETE /terminal/sessions/:id`  → terminate a terminal session (204)
 *
 * WebSocket events:
 * - `terminal:input`  (UI → Backend)  — write to child process stdin
 * - `terminal:output` (Backend → UI)  — stream stdout/stderr chunks
 * - `terminal:exit`   (Backend → UI)  — notify exit code on process close
 *
 * Each terminal session spawns a persistent shell process via
 * `child_process.spawn`. Active sessions are tracked in a
 * `Map<terminalId, ChildProcess>`.
 *
 * @module gateway/routes/terminal.routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { onEvent, emit } from '../ws.server.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Active terminal sessions keyed by terminalId.
 *
 * Each entry holds the spawned child process so that input can be written
 * to stdin and the process can be killed on session termination.
 */
const terminals = new Map<string, ChildProcess>();

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

/** Body for POST /terminal/sessions */
interface CreateTerminalBody {
  sessionId: string;
}

/** Params for DELETE /terminal/sessions/:id */
interface TerminalParams {
  id: string;
}

// ---------------------------------------------------------------------------
// JSON Schemas (Fastify validation)
// ---------------------------------------------------------------------------

const createTerminalSchema = {
  body: {
    type: 'object' as const,
    required: ['sessionId'],
    properties: {
      sessionId: { type: 'string' as const, minLength: 1 },
    },
    additionalProperties: false,
  },
};

const terminalParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'],
    properties: {
      id: { type: 'string' as const },
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the default shell for the current platform.
 */
function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env['COMSPEC'] ?? 'cmd.exe';
  }
  return process.env['SHELL'] ?? '/bin/sh';
}

/**
 * Spawn a persistent shell process and wire its stdout, stderr, and exit
 * events to WebSocket emissions for the given sessionId.
 *
 * @param terminalId - Unique identifier for this terminal session.
 * @param sessionId  - WebSocket session to emit events to.
 * @returns The spawned ChildProcess.
 */
function spawnTerminal(terminalId: string, sessionId: string): ChildProcess {
  const shell = getDefaultShell();
  const workspacePath = process.env['CLOVER_WORKSPACE'] ?? process.cwd();

  const child = spawn(shell, {
    cwd: workspacePath,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // --- stream stdout ---
  child.stdout?.on('data', (data: Buffer) => {
    emit(sessionId, 'terminal:output', {
      terminalId,
      chunk: data.toString(),
      stream: 'stdout',
    });
  });

  // --- stream stderr ---
  child.stderr?.on('data', (data: Buffer) => {
    emit(sessionId, 'terminal:output', {
      terminalId,
      chunk: data.toString(),
      stream: 'stderr',
    });
  });

  // --- process exit ---
  child.on('close', (code) => {
    emit(sessionId, 'terminal:exit', {
      terminalId,
      exitCode: code ?? 1,
    });
    terminals.delete(terminalId);
  });

  // --- spawn error ---
  child.on('error', (err) => {
    emit(sessionId, 'terminal:output', {
      terminalId,
      chunk: `Shell error: ${err.message}\n`,
      stream: 'stderr',
    });
    terminals.delete(terminalId);
  });

  return child;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin that registers terminal session routes and wires
 * WebSocket event handlers for terminal I/O.
 *
 * Registered with a `/api` prefix by the Gateway so that the full paths
 * become `/api/terminal/sessions`, `/api/terminal/sessions/:id`, etc.
 */
export default async function terminalRoutes(fastify: FastifyInstance): Promise<void> {
  // ── WebSocket event wiring ──────────────────────────────

  /**
   * Handle `terminal:input` events from the UI.
   *
   * Writes the received input string to the stdin of the corresponding
   * terminal child process. Silently ignores input for unknown terminals.
   */
  onEvent('terminal:input', (data: unknown) => {
    const payload = data as { terminalId?: string; input?: string };
    if (
      typeof payload?.terminalId !== 'string' ||
      typeof payload?.input !== 'string'
    ) {
      return;
    }

    const child = terminals.get(payload.terminalId);
    if (child?.stdin?.writable) {
      child.stdin.write(payload.input);
    }
  });

  // ── POST /terminal/sessions ─────────────────────────────

  /**
   * Create a new interactive terminal session.
   *
   * Spawns a persistent shell process and returns the generated
   * terminalId. The shell's stdout/stderr are streamed to the client
   * via `terminal:output` WebSocket events.
   */
  fastify.post<{ Body: CreateTerminalBody }>(
    '/terminal/sessions',
    { schema: createTerminalSchema },
    async (request: FastifyRequest<{ Body: CreateTerminalBody }>, reply: FastifyReply) => {
      const { sessionId } = request.body;
      const terminalId = randomUUID();

      const child = spawnTerminal(terminalId, sessionId);
      terminals.set(terminalId, child);

      return reply.status(201).send({ terminalId });
    },
  );

  // ── DELETE /terminal/sessions/:id ───────────────────────

  /**
   * Terminate an active terminal session.
   *
   * Kills the child process and removes it from the active terminals
   * map. Returns 204 No Content on success, 404 if the terminal is
   * not found.
   */
  fastify.delete<{ Params: TerminalParams }>(
    '/terminal/sessions/:id',
    { schema: terminalParamsSchema },
    async (request: FastifyRequest<{ Params: TerminalParams }>, reply: FastifyReply) => {
      const { id } = request.params;

      const child = terminals.get(id);
      if (!child) {
        return reply.status(404).send({
          error: 'Terminal session not found',
          code: 'TERMINAL_NOT_FOUND',
        });
      }

      child.kill('SIGTERM');
      terminals.delete(id);

      return reply.status(204).send();
    },
  );
}
