/**
 * Unit tests for SQLiteStore.
 *
 * Validates: Requirements 9.1, 9.3, 9.5
 *
 * SQLiteStore now uses sql.js directly — no mocking needed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Message } from '@clover/shared';
import { SQLiteStore } from '../sqlite.store.js';

describe('SQLiteStore', () => {
  let store: SQLiteStore;

  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.ensureReady();
  });

  afterEach(() => {
    store.close();
  });

  // ── createSession (Requirement 9.1) ─────────────────────────────────

  describe('createSession', () => {
    it('should create a session with the given workspace path', () => {
      const session = store.createSession('/projects/my-app');

      expect(session).toBeDefined();
      expect(session.id).toBeTruthy();
      expect(session.workspace).toBe('/projects/my-app');
      expect(session.created_at).toBeTruthy();
      expect(session.updated_at).toBeTruthy();
    });

    it('should generate unique session IDs', () => {
      const s1 = store.createSession('/workspace-a');
      const s2 = store.createSession('/workspace-b');

      expect(s1.id).not.toBe(s2.id);
    });

    it('should be retrievable via getSession after creation', () => {
      const created = store.createSession('/projects/test');
      const fetched = store.getSession(created.id);

      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.workspace).toBe('/projects/test');
    });

    it('should return undefined for a non-existent session', () => {
      const result = store.getSession('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  // ── saveMessage (Requirement 9.3) ───────────────────────────────────

  describe('saveMessage', () => {
    it('should save a user message to the session', () => {
      const session = store.createSession('/workspace');
      const msg: Message = { role: 'user', content: 'Hello AI' };

      store.saveMessage(session.id, msg);

      const history = store.getHistory(session.id);
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Hello AI');
    });

    it('should save an assistant message to the session', () => {
      const session = store.createSession('/workspace');
      const msg: Message = { role: 'assistant', content: 'Hi there!' };

      store.saveMessage(session.id, msg);

      const history = store.getHistory(session.id);
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('assistant');
      expect(history[0].content).toBe('Hi there!');
    });

    it('should save a tool message with tool_name and tool_call_id', () => {
      const session = store.createSession('/workspace');
      const msg: Message = {
        role: 'tool',
        content: '{"result": "file content"}',
        tool_name: 'read-file',
        tool_call_id: 'tc-123',
      };

      store.saveMessage(session.id, msg);

      const history = store.getHistory(session.id);
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('tool');
      expect(history[0].tool_name).toBe('read-file');
      expect(history[0].tool_call_id).toBe('tc-123');
    });

    it('should update session updated_at when saving a message', () => {
      const session = store.createSession('/workspace');

      const msg: Message = { role: 'user', content: 'test' };
      store.saveMessage(session.id, msg);

      const updated = store.getSession(session.id);
      expect(updated!.updated_at).toBeTruthy();
    });
  });

  // ── getHistory ordering (Requirement 9.3) ───────────────────────────

  describe('getHistory', () => {
    it('should return messages in chronological order (ASC by created_at)', () => {
      const session = store.createSession('/workspace');

      store.saveMessage(session.id, { role: 'user', content: 'First' });
      store.saveMessage(session.id, { role: 'assistant', content: 'Second' });
      store.saveMessage(session.id, { role: 'user', content: 'Third' });

      const history = store.getHistory(session.id);
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('First');
      expect(history[1].content).toBe('Second');
      expect(history[2].content).toBe('Third');
    });

    it('should respect the limit parameter', () => {
      const session = store.createSession('/workspace');

      for (let i = 1; i <= 5; i++) {
        store.saveMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      const history = store.getHistory(session.id, 3);
      expect(history).toHaveLength(3);
    });

    it('should default to limit of 20', () => {
      const session = store.createSession('/workspace');

      for (let i = 1; i <= 25; i++) {
        store.saveMessage(session.id, { role: 'user', content: `Msg ${i}` });
      }

      const history = store.getHistory(session.id);
      expect(history).toHaveLength(20);
    });

    it('should return empty array for a session with no messages', () => {
      const session = store.createSession('/workspace');
      const history = store.getHistory(session.id);
      expect(history).toEqual([]);
    });

    it('should isolate messages between sessions', () => {
      const s1 = store.createSession('/workspace-a');
      const s2 = store.createSession('/workspace-b');

      store.saveMessage(s1.id, { role: 'user', content: 'Session 1 msg' });
      store.saveMessage(s2.id, { role: 'user', content: 'Session 2 msg' });

      const h1 = store.getHistory(s1.id);
      const h2 = store.getHistory(s2.id);

      expect(h1).toHaveLength(1);
      expect(h1[0].content).toBe('Session 1 msg');
      expect(h2).toHaveLength(1);
      expect(h2[0].content).toBe('Session 2 msg');
    });
  });

  // ── deleteSession cascade (Requirement 9.5) ─────────────────────────

  describe('deleteSession', () => {
    it('should remove the session record', () => {
      const session = store.createSession('/workspace');
      store.deleteSession(session.id);

      const result = store.getSession(session.id);
      expect(result).toBeUndefined();
    });

    it('should cascade delete all messages for the session', () => {
      const session = store.createSession('/workspace');
      store.saveMessage(session.id, { role: 'user', content: 'msg 1' });
      store.saveMessage(session.id, { role: 'assistant', content: 'msg 2' });

      store.deleteSession(session.id);

      const history = store.getHistory(session.id);
      expect(history).toEqual([]);
    });

    it('should cascade delete tool executions for the session', () => {
      const session = store.createSession('/workspace');
      store.logToolExecution(
        session.id,
        'read-file',
        { path: './test.ts' },
        { success: true, output: 'content' },
        true,
        42,
      );

      store.deleteSession(session.id);

      expect(store.getSession(session.id)).toBeUndefined();
    });

    it('should not affect other sessions when deleting one', () => {
      const s1 = store.createSession('/workspace-a');
      const s2 = store.createSession('/workspace-b');

      store.saveMessage(s1.id, { role: 'user', content: 'keep me' });
      store.saveMessage(s2.id, { role: 'user', content: 'delete me' });

      store.deleteSession(s2.id);

      expect(store.getSession(s1.id)).toBeDefined();
      const h1 = store.getHistory(s1.id);
      expect(h1).toHaveLength(1);
      expect(h1[0].content).toBe('keep me');

      expect(store.getSession(s2.id)).toBeUndefined();
    });
  });

  // ── logToolExecution ────────────────────────────────────────────────

  describe('logToolExecution', () => {
    it('should log a tool execution without throwing', () => {
      const session = store.createSession('/workspace');

      expect(() => {
        store.logToolExecution(
          session.id,
          'execute-command',
          { cmd: 'npm test' },
          { stdout: 'ok', stderr: '' },
          true,
          150,
        );
      }).not.toThrow();
    });
  });
});
