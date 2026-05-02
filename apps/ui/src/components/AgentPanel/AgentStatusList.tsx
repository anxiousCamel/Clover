/**
 * AgentStatusList — displays real-time agent statuses received via
 * `agent:status` WebSocket events.
 *
 * Each agent entry shows its name, a color-coded status badge
 * (idle / running / done / error), and elapsed time since the agent
 * started running.
 *
 * All state is read from {@link useAgentStore}. No direct backend
 * calls are made from this component.
 *
 * @module components/AgentPanel/AgentStatusList
 */

import React, { useEffect, useRef, useState } from 'react';
import { useAgentStore } from '../../store/agent.store.js';
import type { AgentStatus } from '@clover/shared';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const listContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 0',
};

const agentRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderRadius: 8,
  backgroundColor: '#1e1e2e',
};

const agentInfoStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const agentNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#e0e0e0',
};

const badgeBaseStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const elapsedStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#6b6b80',
  fontVariantNumeric: 'tabular-nums',
};

const emptyStyle: React.CSSProperties = {
  color: '#6b6b80',
  fontSize: 13,
  textAlign: 'center',
  padding: 16,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<AgentStatus, { bg: string; fg: string }> = {
  idle: { bg: '#2d2d3d', fg: '#a0a0b0' },
  running: { bg: '#1e3a5f', fg: '#60a5fa' },
  done: { bg: '#14532d', fg: '#4ade80' },
  error: { bg: '#3b1111', fg: '#f87171' },
};

function getBadgeStyle(status: AgentStatus): React.CSSProperties {
  const colors = STATUS_COLORS[status];
  return {
    ...badgeBaseStyle,
    backgroundColor: colors.bg,
    color: colors.fg,
  };
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// Elapsed-time tracker hook
// ---------------------------------------------------------------------------

/**
 * Tracks elapsed time for agents that are currently running.
 * Returns a map of agent name → elapsed milliseconds.
 */
function useElapsedTimers(
  agentStatuses: Record<string, { status: AgentStatus }>,
): Record<string, number> {
  const startTimesRef = useRef<Record<string, number>>({});
  const [elapsed, setElapsed] = useState<Record<string, number>>({});

  useEffect(() => {
    // Update start times when agent statuses change
    for (const [name, entry] of Object.entries(agentStatuses)) {
      if (entry.status === 'running' && !startTimesRef.current[name]) {
        startTimesRef.current[name] = Date.now();
      } else if (entry.status !== 'running') {
        delete startTimesRef.current[name];
      }
    }
  }, [agentStatuses]);

  useEffect(() => {
    const hasRunning = Object.values(agentStatuses).some(
      (e) => e.status === 'running',
    );
    if (!hasRunning) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const next: Record<string, number> = {};
      for (const [name, start] of Object.entries(startTimesRef.current)) {
        next[name] = now - start;
      }
      setElapsed(next);
    }, 1000);

    return () => clearInterval(interval);
  }, [agentStatuses]);

  return elapsed;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AgentStatusList: React.FC = () => {
  const agentStatuses = useAgentStore((s) => s.agentStatuses);
  const elapsed = useElapsedTimers(agentStatuses);

  const entries = Object.entries(agentStatuses);

  if (entries.length === 0) {
    return <div style={emptyStyle}>No agents active</div>;
  }

  return (
    <div style={listContainerStyle} role="list" aria-label="Agent statuses">
      {entries.map(([name, entry]) => (
        <div key={name} style={agentRowStyle} role="listitem">
          <div style={agentInfoStyle}>
            <span style={agentNameStyle}>{name}</span>
            <span style={getBadgeStyle(entry.status)}>{entry.status}</span>
          </div>
          {entry.status === 'running' && elapsed[name] != null && (
            <span style={elapsedStyle}>{formatElapsed(elapsed[name])}</span>
          )}
        </div>
      ))}
    </div>
  );
};
