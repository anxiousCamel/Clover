/**
 * ConfirmDialog — modal overlay triggered by `confirmation:request`
 * WebSocket events for destructive operations.
 *
 * Displays the operation name, details, and full arguments. The user
 * must approve or deny before any other UI interaction is possible.
 * Sends a `confirmation:response` event back to the backend.
 *
 * @module components/ConfirmDialog/ConfirmDialog
 */

import React, { useCallback, useEffect, useState } from 'react';
import { onEvent, emit } from '../../api/ws.client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the `confirmation:request` event payload from the backend. */
interface ConfirmationRequestData {
  requestId: string;
  toolName: string;
  operation: string;
  details: string;
  args: unknown;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  zIndex: 9999,
};

const dialogStyle: React.CSSProperties = {
  backgroundColor: '#1e1e2e',
  border: '1px solid #3d3d50',
  borderRadius: 12,
  padding: '24px 28px',
  maxWidth: 520,
  width: '90%',
  maxHeight: '80vh',
  overflow: 'auto',
  color: '#e0e0e0',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  marginBottom: 16,
  color: '#f87171',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#a0a0b0',
  marginBottom: 4,
  marginTop: 12,
};

const valueStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.5,
  color: '#e0e0e0',
  marginBottom: 4,
};

const argsContainerStyle: React.CSSProperties = {
  backgroundColor: '#121220',
  border: '1px solid #2d2d3d',
  borderRadius: 8,
  padding: '10px 12px',
  marginTop: 4,
  maxHeight: 200,
  overflow: 'auto',
};

const argsTextStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: '#c0c0d0',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: 0,
  fontFamily: '"Fira Code", "Cascadia Code", Consolas, monospace',
};

const buttonBarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  marginTop: 20,
};

const baseButtonStyle: React.CSSProperties = {
  padding: '10px 24px',
  borderRadius: 8,
  border: 'none',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const approveButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: '#16a34a',
  color: '#ffffff',
};

const denyButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: '#dc2626',
  color: '#ffffff',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ConfirmDialog: React.FC = () => {
  const [pendingRequest, setPendingRequest] =
    useState<ConfirmationRequestData | null>(null);

  // Listen for confirmation:request events
  useEffect(() => {
    const unsubscribe = onEvent(
      'confirmation:request',
      (data: unknown) => {
        setPendingRequest(data as ConfirmationRequestData);
      },
    );
    return unsubscribe;
  }, []);

  const handleApprove = useCallback(() => {
    if (!pendingRequest) return;
    emit('confirmation:response', {
      requestId: pendingRequest.requestId,
      approved: true,
    });
    setPendingRequest(null);
  }, [pendingRequest]);

  const handleDeny = useCallback(() => {
    if (!pendingRequest) return;
    emit('confirmation:response', {
      requestId: pendingRequest.requestId,
      approved: false,
    });
    setPendingRequest(null);
  }, [pendingRequest]);

  // Handle keyboard shortcuts (Enter to approve, Escape to deny)
  useEffect(() => {
    if (!pendingRequest) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDeny();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingRequest, handleDeny]);

  if (!pendingRequest) return null;

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Confirmation required">
      <div style={dialogStyle}>
        <div style={titleStyle}>⚠ Confirmation Required</div>

        <div style={sectionLabelStyle}>Operation</div>
        <div style={valueStyle}>{pendingRequest.toolName}</div>

        <div style={sectionLabelStyle}>Details</div>
        <div style={valueStyle}>{pendingRequest.details || pendingRequest.operation}</div>

        <div style={sectionLabelStyle}>Arguments</div>
        <div style={argsContainerStyle}>
          <pre style={argsTextStyle}>{formatArgs(pendingRequest.args)}</pre>
        </div>

        <div style={buttonBarStyle}>
          <button
            type="button"
            style={denyButtonStyle}
            onClick={handleDeny}
            aria-label="Deny operation"
          >
            Deny
          </button>
          <button
            type="button"
            style={approveButtonStyle}
            onClick={handleApprove}
            aria-label="Approve operation"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
};
