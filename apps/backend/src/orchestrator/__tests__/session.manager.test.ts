/**
 * Unit tests for Session Manager.
 *
 * Validates: Requirements 9.2, 9.4
 *
 * Tests context window construction order, history limit enforcement,
 * and session isolation (sessions don't share history).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Message, Chunk } from '@clover/shared';
import { SQLiteStore } from '../../storage/sqlite.store.js';
import * as sessionManager from '../session.manager.js';

describe('Session Manager', () => {
  let store: InstanceType<typeof SQLiteStore>;

  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.ensureReady();
    sessionManager.init(store);
  });

  afterEach(() => {
    store.close();
  });

  // ── Context window construction order (Requirement 9.4) ─────────────

  describe('buildContextWindow', () => {
    it('should return messages in order: system prompt, memory chunks, history', () => {
      const session = sessionManager.createSession('/workspace');

      // Save some history messages
      sessionManager.saveMessage(session.id, { role: 'user', content: 'Hello' });
      sessionManager.saveMessage(session.id, { role: 'assistant', content: 'Hi there!' });

      const memoryChunks: Chunk[] = [
        { id: 'c1', source: 'vault', text: 'Relevant context from notes' },
        { id: 'c2', source: 'conversation', text: 'Previous discussion about X' },
      ];

      const result = sessionManager.buildContextWindow(
        session.id,
        memoryChunks,
        'You are a helpful assistant.',
      );

      // 1. First message is the system prompt
      expect(result[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' });

      // 2. Second message is the memory chunks formatted as a Context block
      expect(result[1].role).toBe('system');
      expect(result[1].content).toContain('<Context>');
      expect(result[1].content).toContain('[vault] Relevant context from notes');
      expect(result[1].content).toContain('[conversation] Previous discussion about X');
      expect(result[1].content).toContain('</Context>');

      // 3. Remaining messages are the conversation history
      expect(result[2].role).toBe('user');
      expect(result[2].content).toBe('Hello');
      expect(result[3].role).toBe('assistant');
      expect(result[3].content).toBe('Hi there!');

      // Total: system prompt + memory block + 2 history messages
      expect(result).toHaveLength(4);
    });

    it('should omit memory chunk message when no chunks are provided', () => {
      const session = sessionManager.createSession('/workspace');
      sessionManager.saveMessage(session.id, { role: 'user', content: 'Hello' });

      const result = sessionManager.buildContextWindow(
        session.id,
        [],
        'System prompt here.',
      );

      // system prompt + 1 history message, no memory block
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'system', content: 'System prompt here.' });
      expect(result[1].role).toBe('user');
      expect(result[1].content).toBe('Hello');
    });

    it('should place system prompt first even with no history or chunks', () => {
      const session = sessionManager.createSession('/workspace');

      const result = sessionManager.buildContextWindow(
        session.id,
        [],
        'You are Clover.',
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ role: 'system', content: 'You are Clover.' });
    });

    it('should format memory chunks with source tags', () => {
      const session = sessionManager.createSession('/workspace');

      const chunks: Chunk[] = [
        { id: 'c1', source: 'reversa', text: 'Skill data' },
      ];

      const result = sessionManager.buildContextWindow(
        session.id,
        chunks,
        'prompt',
      );

      const contextMsg = result[1];
      expect(contextMsg.content).toContain('[reversa] Skill data');
    });

    it('should use [memory] tag when chunk source is empty', () => {
      const session = sessionManager.createSession('/workspace');

      const chunks: Chunk[] = [
        { id: 'c1', source: '', text: 'Some data' },
      ];

      const result = sessionManager.buildContextWindow(
        session.id,
        chunks,
        'prompt',
      );

      const contextMsg = result[1];
      expect(contextMsg.content).toContain('[memory] Some data');
    });
  });

  // ── History limit enforcement (Requirement 9.2) ─────────────────────

  describe('loadHistory', () => {
    it('should return all messages when count is below the limit', () => {
      const session = sessionManager.createSession('/workspace');

      sessionManager.saveMessage(session.id, { role: 'user', content: 'msg 1' });
      sessionManager.saveMessage(session.id, { role: 'assistant', content: 'msg 2' });

      const history = sessionManager.loadHistory(session.id);
      expect(history).toHaveLength(2);
    });

    it('should respect explicit limit parameter', () => {
      const session = sessionManager.createSession('/workspace');

      for (let i = 1; i <= 10; i++) {
        sessionManager.saveMessage(session.id, { role: 'user', content: `msg ${i}` });
      }

      const history = sessionManager.loadHistory(session.id, 5);
      expect(history).toHaveLength(5);
    });

    it('should enforce default limit of 20 from config', () => {
      const session = sessionManager.createSession('/workspace');

      for (let i = 1; i <= 30; i++) {
        sessionManager.saveMessage(session.id, { role: 'user', content: `msg ${i}` });
      }

      const history = sessionManager.loadHistory(session.id);
      expect(history).toHaveLength(20);
    });

    it('should return messages in chronological order', () => {
      const session = sessionManager.createSession('/workspace');

      sessionManager.saveMessage(session.id, { role: 'user', content: 'first' });
      sessionManager.saveMessage(session.id, { role: 'assistant', content: 'second' });
      sessionManager.saveMessage(session.id, { role: 'user', content: 'third' });

      const history = sessionManager.loadHistory(session.id);
      expect(history[0].content).toBe('first');
      expect(history[1].content).toBe('second');
      expect(history[2].content).toBe('third');
    });
  });

  // ── Session isolation (Requirement 9.4) ─────────────────────────────

  describe('session isolation', () => {
    it('should not share history between different sessions', () => {
      const session1 = sessionManager.createSession('/workspace-a');
      const session2 = sessionManager.createSession('/workspace-b');

      sessionManager.saveMessage(session1.id, { role: 'user', content: 'Session 1 message' });
      sessionManager.saveMessage(session2.id, { role: 'user', content: 'Session 2 message' });

      const history1 = sessionManager.loadHistory(session1.id);
      const history2 = sessionManager.loadHistory(session2.id);

      expect(history1).toHaveLength(1);
      expect(history1[0].content).toBe('Session 1 message');

      expect(history2).toHaveLength(1);
      expect(history2[0].content).toBe('Session 2 message');
    });

    it('should build independent context windows for different sessions', () => {
      const session1 = sessionManager.createSession('/workspace-a');
      const session2 = sessionManager.createSession('/workspace-b');

      sessionManager.saveMessage(session1.id, { role: 'user', content: 'S1 msg' });
      sessionManager.saveMessage(session2.id, { role: 'user', content: 'S2 msg' });
      sessionManager.saveMessage(session2.id, { role: 'assistant', content: 'S2 reply' });

      const ctx1 = sessionManager.buildContextWindow(session1.id, [], 'prompt');
      const ctx2 = sessionManager.buildContextWindow(session2.id, [], 'prompt');

      // Session 1: system prompt + 1 history message
      expect(ctx1).toHaveLength(2);
      expect(ctx1[1].content).toBe('S1 msg');

      // Session 2: system prompt + 2 history messages
      expect(ctx2).toHaveLength(3);
      expect(ctx2[1].content).toBe('S2 msg');
      expect(ctx2[2].content).toBe('S2 reply');
    });

    it('should not affect one session when another is deleted', () => {
      const session1 = sessionManager.createSession('/workspace-a');
      const session2 = sessionManager.createSession('/workspace-b');

      sessionManager.saveMessage(session1.id, { role: 'user', content: 'keep me' });
      sessionManager.saveMessage(session2.id, { role: 'user', content: 'delete me' });

      sessionManager.deleteSession(session2.id);

      const history1 = sessionManager.loadHistory(session1.id);
      expect(history1).toHaveLength(1);
      expect(history1[0].content).toBe('keep me');

      // Deleted session should have no history
      const history2 = sessionManager.loadHistory(session2.id);
      expect(history2).toHaveLength(0);
    });
  });

  // ── Model persistence (Requirement 20.3) ────────────────────────────

  describe('model persistence', () => {
    it('should persist and retrieve the selected model', () => {
      const session = sessionManager.createSession('/workspace');

      sessionManager.setModel(session.id, 'llama3:8b');
      const model = sessionManager.getModel(session.id);

      expect(model).toBe('llama3:8b');
    });

    it('should return null when no model has been set', () => {
      const session = sessionManager.createSession('/workspace');
      const model = sessionManager.getModel(session.id);

      expect(model).toBeNull();
    });
  });
});
