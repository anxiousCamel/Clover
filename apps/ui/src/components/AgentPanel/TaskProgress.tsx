/**
 * TaskProgress — displays active tool calls and provides a cancel
 * button to abort the current agent run.
 *
 * Active tool calls are read from {@link useAgentStore}. The cancel
 * button emits an `agent:cancel` WebSocket event via {@link wsClient}.
 *
 * @module components/AgentPanel/TaskProgress
 */

import React, { useCallback } from 'react';
import { useAgentStore } from '../../store/agent.store.js';
import { useSessionStore } from '../../store/session.store.js';
import * as wsClient from '../../api/ws.client.js';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 0',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#6b6b80',
  marginBottom: 4,
};

const toolCallRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderRadius: 6,
  backgroundColor: '#1e1e2e',
  fontSize: 13,
  color: '#e0e0e0',
};

const toolNameStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#60a5fa',
  fontFamily: '"Fira Code", "Cascadia Code", "Consolas", monospace',
  fontSize: 12,
};

const toolArgsStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#6b6b80',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
};

const spinnerStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 12,
  height: 12,
  border: '2px solid #3d3d50',
  borderTopColor: '#60a5fa',
  borderRadius: '50%',
  animation: 'clover-spin 0.8s linear infinite',
  flexShrink: 0,
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid #5c1a1a',
  backgroundColor: '#3b1111',
  color: '#f87171',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  alignSelf: 'flex-start',
  marginTop: 4,
};

const cancelButtonDisabledStyle: React.CSSProperties = {
  ...cancelButtonStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

const emptyStyle: React.CSSProperties = {
  color: '#6b6b80',
  fontSize: 13,
  textAlign: 'center',
  padding: 16,
};

// ---------------------------------------------------------------------------
// Keyframe injection
// ---------------------------------------------------------------------------

const SPIN_STYLE_ID = 'clover-spin-keyframes';

function ensureSpinKeyframes(): void {
  if (document.getElementById(SPIN_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = SPIN_STYLE_ID;
  style.textContent = `
    @keyframes clover-spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => {
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      const truncated = str.length > 40 ? `${str.slice(0, 40)}…` : str;
      return `${key}: ${truncated}`;
    })
    .join(', ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TaskProgress: React.FC = () => {
  const activeToolCalls = useAgentStore((s) => s.activeToolCalls);
  const agentStatuses = useAgentStore((s) => s.agentStatuses);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  // Inject spinner keyframes on first render
  React.useEffect(() => {
    ensureSpinKeyframes();
  }, []);

  const hasRunningAgent = Object.values(agentStatuses).some(
    (entry) => entry.status === 'running',
  );

  const handleCancel = useCallback(() => {
    if (!activeSessionId || !hasRunningAgent) return;
    wsClient.emit('agent:cancel', { sessionId: activeSessionId });
  }, [activeSessionId, hasRunningAgent]);

  if (activeToolCalls.length === 0 && !hasRunningAgent) {
    return <div style={emptyStyle}>No active tasks</div>;
  }

  return (
    <div style={containerStyle}>
      {/* Active tool calls */}
      {activeToolCalls.length > 0 && (
        <>
          <div style={sectionLabelStyle}>Active Tool Calls</div>
          <div role="list" aria-label="Active tool calls">
            {activeToolCalls.map((tc, idx) => (
              <div key={`${tc.toolName}-${idx}`} style={toolCallRowStyle} role="listitem">
                <span style={spinnerStyle} aria-hidden="true" />
                <span style={toolNameStyle}>{tc.toolName}</span>
                <span style={toolArgsStyle} title={summarizeArgs(tc.args)}>
                  {summarizeArgs(tc.args)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Cancel button */}
      {hasRunningAgent && (
        <button
          type="button"
          style={activeSessionId ? cancelButtonStyle : cancelButtonDisabledStyle}
          onClick={handleCancel}
          disabled={!activeSessionId}
          aria-label="Cancel agent execution"
        >
          Cancel
        </button>
      )}
    </div>
  );
};
