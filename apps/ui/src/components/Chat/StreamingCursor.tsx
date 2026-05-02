/**
 * StreamingCursor — displays the assistant's in-progress streaming
 * response with a blinking cursor animation.
 *
 * Reads `currentStreamText` and `isStreaming` from the chat store.
 * Only renders when `isStreaming` is true and there is text to display.
 *
 * The blinking cursor is implemented via a CSS keyframe animation
 * injected into a `<style>` tag on first mount.
 *
 * @module components/Chat/StreamingCursor
 */

import React, { useEffect } from 'react';
import { useChatStore } from '../../store/chat.store.js';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  maxWidth: '80%',
  padding: '10px 14px',
  borderRadius: 12,
  borderBottomLeftRadius: 4,
  backgroundColor: '#1e1e2e',
  color: '#e0e0e0',
  fontSize: 14,
  lineHeight: 1.5,
  wordBreak: 'break-word',
};

const labelStyle: React.CSSProperties = {
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

const cursorStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 2,
  height: '1em',
  backgroundColor: '#e0e0e0',
  marginLeft: 2,
  verticalAlign: 'text-bottom',
  animation: 'clover-cursor-blink 1s step-end infinite',
};

// ---------------------------------------------------------------------------
// Keyframe injection
// ---------------------------------------------------------------------------

const STYLE_ID = 'clover-cursor-keyframes';

function ensureKeyframes(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes clover-cursor-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const StreamingCursor: React.FC = () => {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentStreamText = useChatStore((s) => s.currentStreamText);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  if (!isStreaming) return null;

  return (
    <div style={containerStyle}>
      <div style={labelStyle}>Clover</div>
      <pre style={contentStyle}>
        {currentStreamText}
        <span style={cursorStyle} />
      </pre>
    </div>
  );
};
