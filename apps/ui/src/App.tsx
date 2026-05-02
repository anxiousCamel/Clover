/**
 * App — root layout component that wires together all UI panels and
 * initialises the WebSocket connection and session on mount.
 *
 * Layout (CSS Grid):
 * - Left sidebar: FileExplorer (FileTree + FilePreview)
 * - Main area: ModelSelector (top bar) + Chat (fills remaining space)
 * - Right panel: AgentPanel (AgentStatusList + TaskProgress)
 * - Bottom panel: Terminal
 * - Global overlay: ConfirmDialog (always mounted, shows/hides based on pending requests)
 *
 * All network calls go through http.client or ws.client — no component
 * imports from `apps/backend/`.
 *
 * @module App
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

// API layer
import * as wsClient from './api/ws.client.js';

// Stores
import { useSessionStore } from './store/session.store.js';
import { useAgentStore } from './store/agent.store.js';
import { useChatStore } from './store/chat.store.js';

// Components
import { ChatWindow } from './components/Chat/ChatWindow.js';
import { FileTree } from './components/FileExplorer/FileTree.js';
import type { FileNode } from './components/FileExplorer/FileTree.js';
import { FilePreview } from './components/FileExplorer/FilePreview.js';
import { TerminalPane } from './components/Terminal/TerminalPane.js';
import { AgentStatusList } from './components/AgentPanel/AgentStatusList.js';
import { TaskProgress } from './components/AgentPanel/TaskProgress.js';
import { ConfirmDialog } from './components/ConfirmDialog/ConfirmDialog.js';
import { ModelSelector } from './components/ModelSelector/ModelSelector.js';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const appContainerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '240px 1fr 260px',
  gridTemplateRows: '1fr 200px',
  gridTemplateAreas: `
    "sidebar main   agents"
    "sidebar terminal agents"
  `,
  height: '100vh',
  width: '100vw',
  overflow: 'hidden',
  backgroundColor: '#0e0e1a',
  color: '#e0e0e0',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const sidebarStyle: React.CSSProperties = {
  gridArea: 'sidebar',
  display: 'flex',
  flexDirection: 'column',
  borderRight: '1px solid #2d2d3d',
  overflow: 'hidden',
};

const mainStyle: React.CSSProperties = {
  gridArea: 'main',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const terminalAreaStyle: React.CSSProperties = {
  gridArea: 'terminal',
  borderTop: '1px solid #2d2d3d',
  overflow: 'hidden',
};

const agentPanelStyle: React.CSSProperties = {
  gridArea: 'agents',
  display: 'flex',
  flexDirection: 'column',
  borderLeft: '1px solid #2d2d3d',
  overflow: 'auto',
  padding: '12px',
  backgroundColor: '#121220',
};

const agentPanelHeaderStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#6b6b80',
  marginBottom: 8,
};

const chatAreaStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
};

const loadingOverlayStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  width: '100vw',
  backgroundColor: '#0e0e1a',
  color: '#6b6b80',
  fontSize: 16,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const errorOverlayStyle: React.CSSProperties = {
  ...loadingOverlayStyle,
  color: '#f87171',
  flexDirection: 'column',
  gap: 12,
};

const retryButtonStyle: React.CSSProperties = {
  padding: '8px 20px',
  borderRadius: 8,
  border: '1px solid #3d3d50',
  backgroundColor: '#1e1e2e',
  color: '#e0e0e0',
  fontSize: 14,
  cursor: 'pointer',
};

// ---------------------------------------------------------------------------
// Default workspace path
// ---------------------------------------------------------------------------

const DEFAULT_WORKSPACE_PATH = '.';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const App: React.FC = () => {
  const createSession = useSessionStore((s) => s.createSession);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const loading = useSessionStore((s) => s.loading);
  const sessionError = useSessionStore((s) => s.error);
  const subscribeAgents = useAgentStore((s) => s.subscribe);
  const subscribeChat = useChatStore((s) => s.subscribe);

  const [selectedFile, setSelectedFile] = useState<{
    node: FileNode;
    path: string;
  } | null>(null);

  const agentUnsubRef = useRef<(() => void) | null>(null);
  const chatUnsubRef = useRef<(() => void) | null>(null);
  const wsConnectedRef = useRef(false);

  // -----------------------------------------------------------------------
  // 1. Create session on mount
  // -----------------------------------------------------------------------
  useEffect(() => {
    void createSession(DEFAULT_WORKSPACE_PATH);
  }, [createSession]);

  // -----------------------------------------------------------------------
  // 2. Connect WebSocket after session is created
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!activeSessionId) return;

    wsClient.connect(activeSessionId);
    wsConnectedRef.current = true;

    return () => {
      wsClient.disconnect();
      wsConnectedRef.current = false;
    };
  }, [activeSessionId]);

  // -----------------------------------------------------------------------
  // 3. Subscribe to agent store events after WebSocket is connected
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!activeSessionId || !wsConnectedRef.current) return;

    agentUnsubRef.current = subscribeAgents();
    chatUnsubRef.current = subscribeChat();

    return () => {
      agentUnsubRef.current?.();
      agentUnsubRef.current = null;
      chatUnsubRef.current?.();
      chatUnsubRef.current = null;
    };
  }, [activeSessionId, subscribeAgents, subscribeChat]);

  // -----------------------------------------------------------------------
  // File selection handler
  // -----------------------------------------------------------------------
  const handleSelectFile = useCallback((node: FileNode, path: string) => {
    setSelectedFile({ node, path });
  }, []);

  // -----------------------------------------------------------------------
  // Retry handler for session creation errors
  // -----------------------------------------------------------------------
  const handleRetry = useCallback(() => {
    void createSession(DEFAULT_WORKSPACE_PATH);
  }, [createSession]);

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------
  if (loading && !activeSessionId) {
    return <div style={loadingOverlayStyle}>Initializing Clover…</div>;
  }

  // -----------------------------------------------------------------------
  // Error state
  // -----------------------------------------------------------------------
  if (sessionError && !activeSessionId) {
    return (
      <div style={errorOverlayStyle}>
        <span>Failed to initialize session: {sessionError}</span>
        <button type="button" style={retryButtonStyle} onClick={handleRetry}>
          Retry
        </button>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Main layout
  // -----------------------------------------------------------------------
  return (
    <>
      <div style={appContainerStyle}>
        {/* Sidebar — File Explorer */}
        <div style={sidebarStyle}>
          {selectedFile ? (
            <FilePreview node={selectedFile.node} path={selectedFile.path} />
          ) : (
            <FileTree onSelectFile={handleSelectFile} />
          )}
          {selectedFile && (
            <button
              type="button"
              style={{
                padding: '6px 12px',
                fontSize: 12,
                color: '#a0a0b8',
                backgroundColor: 'transparent',
                border: 'none',
                borderTop: '1px solid #2d2d3d',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onClick={() => setSelectedFile(null)}
              aria-label="Back to file tree"
            >
              ← Back to Explorer
            </button>
          )}
        </div>

        {/* Main area — Model Selector + Chat */}
        <div style={mainStyle}>
          <ModelSelector />
          <div style={chatAreaStyle}>
            <ChatWindow />
          </div>
        </div>

        {/* Bottom panel — Terminal */}
        <div style={terminalAreaStyle}>
          <TerminalPane />
        </div>

        {/* Right panel — Agent Panel */}
        <div style={agentPanelStyle}>
          <div style={agentPanelHeaderStyle}>Agents</div>
          <AgentStatusList />
          <TaskProgress />
        </div>
      </div>

      {/* Global overlay — Confirmation Dialog */}
      <ConfirmDialog />
    </>
  );
};
