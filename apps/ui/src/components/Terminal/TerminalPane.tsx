/**
 * TerminalPane — integrated terminal emulator panel using xterm.js,
 * connected to the backend via WebSocket for real-time terminal I/O.
 *
 * On mount the component creates a terminal session via the REST API,
 * initialises an xterm.js {@link Terminal} instance with the
 * {@link FitAddon} for auto-resizing, and subscribes to WebSocket
 * events for output streaming and process exit notifications.
 *
 * User keystrokes are forwarded to the backend as `terminal:input`
 * WebSocket events. Backend responses arrive as `terminal:output`
 * (stdout/stderr chunks) and `terminal:exit` (process exit code).
 *
 * @module components/Terminal/TerminalPane
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import * as ws from '../../api/ws.client.js';
import * as http from '../../api/http.client.js';
import { useSessionStore } from '../../store/session.store.js';

// NOTE: xterm.js requires 'xterm/css/xterm.css' to be imported at the
// application level (e.g. in main.tsx or App.tsx) for proper rendering.
// Vite handles CSS imports at build time via its CSS pipeline.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the response from POST /api/terminal/sessions. */
interface CreateTerminalResponse {
  terminalId: string;
}

/** Payload received via `terminal:output` WebSocket events. */
interface TerminalOutputData {
  terminalId: string;
  chunk: string;
  stream: 'stdout' | 'stderr';
}

/** Payload received via `terminal:exit` WebSocket events. */
interface TerminalExitData {
  terminalId: string;
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const paneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: '#121220',
  color: '#e0e0e0',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 16px',
  borderBottom: '1px solid #2d2d3d',
  fontSize: 13,
  fontWeight: 600,
  color: '#a0a0b8',
};

const terminalContainerStyle: React.CSSProperties = {
  flex: 1,
  padding: '4px 8px',
  overflow: 'hidden',
};

const statusStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 400,
};

const errorBannerStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: '#3b1111',
  color: '#f87171',
  fontSize: 13,
  borderBottom: '1px solid #5c1a1a',
};

const exitBannerStyle: React.CSSProperties = {
  padding: '6px 16px',
  fontSize: 12,
  borderTop: '1px solid #2d2d3d',
  color: '#a0a0b8',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TerminalPane: React.FC = () => {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // -----------------------------------------------------------------------
  // Create terminal session via REST API
  // -----------------------------------------------------------------------
  const createTerminalSession = useCallback(async (sessionId: string): Promise<string | null> => {
    try {
      const res = await http.post<CreateTerminalResponse>('/terminal/sessions', {
        sessionId,
      });
      return res.terminalId;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create terminal session';
      setError(message);
      return null;
    }
  }, []);

  // -----------------------------------------------------------------------
  // Delete terminal session via REST API
  // -----------------------------------------------------------------------
  const deleteTerminalSession = useCallback(async (terminalId: string): Promise<void> => {
    try {
      await http.del(`/terminal/sessions/${terminalId}`);
    } catch {
      // Best-effort cleanup — ignore errors on teardown
    }
  }, []);

  // -----------------------------------------------------------------------
  // Lifecycle: initialise xterm + WebSocket subscriptions on mount
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!activeSessionId || !terminalRef.current) return;

    let disposed = false;

    // Create xterm.js Terminal instance
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Fira Code", "Cascadia Code", "JetBrains Mono", Menlo, Monaco, monospace',
      theme: {
        background: '#121220',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        selectionBackground: '#3d3d50',
      },
      convertEol: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Mount terminal into the DOM
    term.open(terminalRef.current);

    // Fit terminal to container after a short delay to allow layout
    requestAnimationFrame(() => {
      if (!disposed) {
        try {
          fitAddon.fit();
        } catch {
          // Container may not be visible yet — safe to ignore
        }
      }
    });

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle window resize
    const handleResize = (): void => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors during rapid resizing
      }
    };
    window.addEventListener('resize', handleResize);

    // -------------------------------------------------------------------
    // WebSocket event handlers
    // -------------------------------------------------------------------

    const handleOutput = (data: unknown): void => {
      const payload = data as TerminalOutputData;
      if (payload.terminalId !== terminalIdRef.current) return;
      term.write(payload.chunk);
    };

    const handleExit = (data: unknown): void => {
      const payload = data as TerminalExitData;
      if (payload.terminalId !== terminalIdRef.current) return;

      const code = payload.exitCode;
      setExitCode(code);

      const color = code === 0 ? '\x1b[32m' : '\x1b[31m';
      term.write(`\r\n${color}Process exited with code ${code}\x1b[0m\r\n`);
    };

    const unsubOutput = ws.onEvent('terminal:output', handleOutput);
    const unsubExit = ws.onEvent('terminal:exit', handleExit);

    // -------------------------------------------------------------------
    // Forward user input to backend
    // -------------------------------------------------------------------

    const onDataDisposable = term.onData((input: string) => {
      if (terminalIdRef.current) {
        ws.emit('terminal:input', {
          terminalId: terminalIdRef.current,
          input,
        });
      }
    });

    // -------------------------------------------------------------------
    // Create terminal session
    // -------------------------------------------------------------------

    void (async () => {
      const termId = await createTerminalSession(activeSessionId);
      if (disposed || !termId) return;

      terminalIdRef.current = termId;
      setIsConnected(true);
      setError(null);
      setExitCode(null);

      term.write('\x1b[90m$ Terminal session started\x1b[0m\r\n');
    })();

    // -------------------------------------------------------------------
    // Cleanup on unmount
    // -------------------------------------------------------------------

    return () => {
      disposed = true;

      window.removeEventListener('resize', handleResize);
      unsubOutput();
      unsubExit();
      onDataDisposable.dispose();

      // Delete terminal session (best-effort)
      if (terminalIdRef.current) {
        void deleteTerminalSession(terminalIdRef.current);
        terminalIdRef.current = null;
      }

      // Dispose xterm
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;

      setIsConnected(false);
    };
  }, [activeSessionId, createTerminalSession, deleteTerminalSession]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div style={paneStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span>Terminal</span>
        <span style={statusStyle}>
          {isConnected ? '● Connected' : '○ Disconnected'}
        </span>
      </div>

      {/* Error banner */}
      {error && <div style={errorBannerStyle}>{error}</div>}

      {/* Terminal container */}
      <div
        ref={terminalRef}
        style={terminalContainerStyle}
        aria-label="Terminal emulator"
      />

      {/* Exit code banner */}
      {exitCode !== null && (
        <div style={exitBannerStyle}>
          Exit code: {exitCode}
        </div>
      )}
    </div>
  );
};
