/**
 * MessageBubble — renders a single chat message with role-based styling.
 *
 * User messages are right-aligned with a distinct background; assistant
 * messages are left-aligned. Content is rendered as pre-formatted text
 * to preserve whitespace and code formatting.
 *
 * @module components/Chat/MessageBubble
 */

import React from 'react';
import type { Message } from '@clover/shared';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const baseStyle: React.CSSProperties = {
  maxWidth: '80%',
  padding: '10px 14px',
  borderRadius: 12,
  fontSize: 14,
  lineHeight: 1.5,
  wordBreak: 'break-word',
};

const userBubbleStyle: React.CSSProperties = {
  ...baseStyle,
  alignSelf: 'flex-end',
  backgroundColor: '#2563eb',
  color: '#ffffff',
  borderBottomRightRadius: 4,
};

const assistantBubbleStyle: React.CSSProperties = {
  ...baseStyle,
  alignSelf: 'flex-start',
  backgroundColor: '#1e1e2e',
  color: '#e0e0e0',
  borderBottomLeftRadius: 4,
};

const systemBubbleStyle: React.CSSProperties = {
  ...baseStyle,
  alignSelf: 'center',
  backgroundColor: '#2d2d3d',
  color: '#a0a0b0',
  fontSize: 12,
  fontStyle: 'italic',
};

const roleLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 4,
  opacity: 0.7,
};

const contentStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  margin: 0,
  fontFamily: 'inherit',
};

const timestampStyle: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.5,
  marginTop: 4,
  textAlign: 'right',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MessageBubbleProps {
  message: Message;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function getBubbleStyle(role: Message['role']): React.CSSProperties {
  switch (role) {
    case 'user':
      return userBubbleStyle;
    case 'assistant':
      return assistantBubbleStyle;
    case 'system':
    case 'tool':
      return systemBubbleStyle;
    default:
      return assistantBubbleStyle;
  }
}

function getRoleLabel(role: Message['role']): string {
  switch (role) {
    case 'user':
      return 'You';
    case 'assistant':
      return 'Clover';
    case 'system':
      return 'System';
    case 'tool':
      return 'Tool';
    default:
      return role;
  }
}

function formatTimestamp(isoString?: string): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const bubbleStyle = getBubbleStyle(message.role);
  const label = getRoleLabel(message.role);
  const time = formatTimestamp(message.created_at);

  return (
    <div style={bubbleStyle}>
      <div style={roleLabelStyle}>{label}</div>
      <pre style={contentStyle}>{message.content}</pre>
      {time && <div style={timestampStyle}>{time}</div>}
    </div>
  );
};
