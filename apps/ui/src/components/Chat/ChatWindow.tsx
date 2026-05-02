/**
 * ChatWindow — main chat container that renders the message history,
 * streaming cursor, input field, and send button.
 *
 * All state is managed through {@link useChatStore} and
 * {@link useSessionStore}. No direct backend calls are made from this
 * component.
 *
 * @module components/Chat/ChatWindow
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../store/chat.store.js';
import { useSessionStore } from '../../store/session.store.js';
import { MessageBubble } from './MessageBubble.js';
import { StreamingCursor } from './StreamingCursor.js';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const windowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: '#121220',
  color: '#e0e0e0',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const messageListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '16px 16px 8px',
};

const emptyStateStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6b6b80',
  fontSize: 14,
  textAlign: 'center',
  padding: 32,
};

const inputBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 8,
  padding: '8px 16px 16px',
  borderTop: '1px solid #2d2d3d',
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
  resize: 'none',
  border: '1px solid #3d3d50',
  borderRadius: 8,
  backgroundColor: '#1e1e2e',
  color: '#e0e0e0',
  padding: '10px 12px',
  fontSize: 14,
  lineHeight: 1.5,
  fontFamily: 'inherit',
  outline: 'none',
  minHeight: 42,
  maxHeight: 160,
  overflow: 'auto',
};

const sendButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: 8,
  border: 'none',
  backgroundColor: '#2563eb',
  color: '#ffffff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const sendButtonDisabledStyle: React.CSSProperties = {
  ...sendButtonStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

const errorBannerStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: '#3b1111',
  color: '#f87171',
  fontSize: 13,
  borderBottom: '1px solid #5c1a1a',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ChatWindow: React.FC = () => {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const error = useChatStore((s) => s.error);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const subscribe = useChatStore((s) => s.subscribe);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const [inputValue, setInputValue] = useState('');
  const messageListRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Subscribe to WebSocket events on mount
  useEffect(() => {
    const unsubscribe = subscribe();
    return unsubscribe;
  }, [subscribe]);

  // Auto-scroll to bottom when messages change or streaming text updates
  const currentStreamText = useChatStore((s) => s.currentStreamText);
  useEffect(() => {
    const el = messageListRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, currentStreamText]);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || !activeSessionId || isStreaming) return;

    sendMessage(activeSessionId, trimmed);
    setInputValue('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [inputValue, activeSessionId, isStreaming, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Send on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);

      // Auto-resize textarea
      const textarea = e.target;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    },
    [],
  );

  const canSend = inputValue.trim().length > 0 && !!activeSessionId && !isStreaming;

  return (
    <div style={windowStyle}>
      {/* Error banner */}
      {error && <div style={errorBannerStyle}>{error}</div>}

      {/* Message list */}
      {messages.length === 0 && !isStreaming ? (
        <div style={emptyStateStyle}>
          <span>Send a message to start a conversation with Clover.</span>
        </div>
      ) : (
        <div ref={messageListRef} style={messageListStyle}>
          {messages.map((msg, idx) => (
            <MessageBubble key={msg.id ?? idx} message={msg} />
          ))}
          <StreamingCursor />
        </div>
      )}

      {/* Input bar */}
      <div style={inputBarStyle}>
        <textarea
          ref={textareaRef}
          style={textareaStyle}
          value={inputValue}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          rows={1}
          disabled={!activeSessionId}
          aria-label="Chat message input"
        />
        <button
          type="button"
          style={canSend ? sendButtonStyle : sendButtonDisabledStyle}
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
        >
          Send
        </button>
      </div>
    </div>
  );
};
