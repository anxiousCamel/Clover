/**
 * Unit tests for SubagentContext factory.
 *
 * Validates: Requirements 3.1.2, 3.1.3, 3.1.4, 3.2.4, 3.2.5
 *
 * Tests that createSubagentContext produces isolated contexts with
 * independent chat history, independent token budget, and inherited
 * workspace path.
 */
import { describe, it, expect } from 'vitest';
import {
  createSubagentContext,
  type SubagentContext,
  type CreateSubagentContextOptions,
} from '../subagent-context.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseOptions: CreateSubagentContextOptions = {
  parentSessionId: 'parent-session-123',
  goal: 'Write unit tests for auth module',
  depth: 1,
  workspacePath: '/home/user/project',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubagentContext', () => {
  describe('createSubagentContext', () => {
    it('should create a context with a unique UUID id', () => {
      const ctx = createSubagentContext(baseOptions);
      // UUID v4 format: 8-4-4-4-12 hex chars
      expect(ctx.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('should generate different ids for each context', () => {
      const ctx1 = createSubagentContext(baseOptions);
      const ctx2 = createSubagentContext(baseOptions);
      expect(ctx1.id).not.toBe(ctx2.id);
    });

    it('should set parentSessionId from options', () => {
      const ctx = createSubagentContext(baseOptions);
      expect(ctx.parentSessionId).toBe('parent-session-123');
    });

    it('should set goal from options', () => {
      const ctx = createSubagentContext(baseOptions);
      expect(ctx.goal).toBe('Write unit tests for auth module');
    });

    it('should set depth from options', () => {
      const ctx = createSubagentContext(baseOptions);
      expect(ctx.depth).toBe(1);
    });

    it('should inherit workspace path from parent (Req 3.2.5)', () => {
      const ctx = createSubagentContext(baseOptions);
      expect(ctx.workspacePath).toBe('/home/user/project');
    });

    it('should start with status "running"', () => {
      const ctx = createSubagentContext(baseOptions);
      expect(ctx.status).toBe('running');
    });

    it('should start with no result', () => {
      const ctx = createSubagentContext(baseOptions);
      expect(ctx.result).toBeUndefined();
    });

    // ── Isolated chat history (Req 3.1.2, 3.1.3) ───────────────────

    it('should create an empty isolated chat history (Req 3.1.2)', () => {
      const ctx = createSubagentContext(baseOptions);
      expect(ctx.chatHistory).toEqual([]);
      expect(ctx.chatHistory).toBeInstanceOf(Array);
    });

    it('should not share chat history between contexts (Req 3.1.3)', () => {
      const ctx1 = createSubagentContext(baseOptions);
      const ctx2 = createSubagentContext(baseOptions);

      ctx1.chatHistory.push({ role: 'user', content: 'hello from ctx1' });

      expect(ctx1.chatHistory).toHaveLength(1);
      expect(ctx2.chatHistory).toHaveLength(0);
    });

    // ── Independent token budget (Req 3.2.4) ────────────────────────

    it('should default token budget to 4096 (Req 3.2.4)', () => {
      const ctx = createSubagentContext(baseOptions);
      expect(ctx.tokenBudget).toBe(4096);
    });

    it('should accept a custom token budget', () => {
      const ctx = createSubagentContext({ ...baseOptions, tokenBudget: 8192 });
      expect(ctx.tokenBudget).toBe(8192);
    });

    it('should have independent token budgets between contexts', () => {
      const ctx1 = createSubagentContext({ ...baseOptions, tokenBudget: 2048 });
      const ctx2 = createSubagentContext({ ...baseOptions, tokenBudget: 8192 });
      expect(ctx1.tokenBudget).toBe(2048);
      expect(ctx2.tokenBudget).toBe(8192);
    });

    // ── Optional fields (Req 3.1.4) ─────────────────────────────────

    it('should pass through agentType when provided', () => {
      const ctx = createSubagentContext({
        ...baseOptions,
        agentType: 'test-writer',
      });
      expect(ctx.agentType).toBe('test-writer');
    });

    it('should leave agentType undefined when not provided', () => {
      const ctx = createSubagentContext(baseOptions);
      expect(ctx.agentType).toBeUndefined();
    });

    it('should pass through systemPrompt when provided (Req 3.1.4)', () => {
      const ctx = createSubagentContext({
        ...baseOptions,
        systemPrompt: 'You are a test-writing expert.',
      });
      expect(ctx.systemPrompt).toBe('You are a test-writing expert.');
    });

    it('should leave systemPrompt undefined when not provided', () => {
      const ctx = createSubagentContext(baseOptions);
      expect(ctx.systemPrompt).toBeUndefined();
    });
  });
});
