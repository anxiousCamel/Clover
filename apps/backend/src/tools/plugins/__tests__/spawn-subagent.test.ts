/**
 * Unit tests for spawn-subagent tool.
 *
 * Validates: Requirements 3.1.1, 3.1.4, 3.2.5, 3.3.3
 *
 * - Tool registered with correct Zod schema (Req 3.1.1)
 * - systemPrompt passed through to SubagentContext (Req 3.1.4)
 * - Workspace path inherited from parent (Req 3.2.5)
 * - Depth resets on new top-level message (Req 3.3.3)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import type { ToolContext } from '@clover/shared';
import { TOOL_NAMES } from '@clover/shared';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test
// ---------------------------------------------------------------------------

// Mock the config module so we can control maxSubagentDepth
vi.mock('../../../config/config.js', () => ({
  config: {
    maxSubagentDepth: 3,
  },
}));

// Mock createSubagentContext to capture the options it receives
const mockCreateSubagentContext = vi.fn();
vi.mock('../../../orchestrator/subagent-context.js', () => ({
  createSubagentContext: (...args: unknown[]) => mockCreateSubagentContext(...args),
}));

// Import the module under test (uses mocked dependencies)
import plugin, {
  getDepth,
  incrementDepth,
  resetDepth,
} from '../spawn-subagent.tool.js';
import { config } from '../../../config/config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspacePath: overrides.workspacePath ?? '/test-workspace',
    sessionId: overrides.sessionId ?? 'session-1',
    execGuard: overrides.execGuard ?? {
      execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    },
    emitEvent: overrides.emitEvent ?? vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Spawn Subagent Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock: return a minimal SubagentContext-like object
    mockCreateSubagentContext.mockImplementation((opts: Record<string, unknown>) => ({
      id: 'sub-uuid-123',
      parentSessionId: opts.parentSessionId,
      goal: opts.goal,
      agentType: opts.agentType,
      systemPrompt: opts.systemPrompt,
      depth: opts.depth,
      chatHistory: [],
      workspacePath: opts.workspacePath,
      tokenBudget: opts.tokenBudget ?? 4096,
      status: 'running',
    }));

    // Reset depth for all sessions
    resetDepth('session-1');
    resetDepth('session-2');

    // Ensure default config
    (config as Record<string, unknown>).maxSubagentDepth = 3;
  });

  afterEach(() => {
    resetDepth('session-1');
    resetDepth('session-2');
  });

  // ========================================================================
  // Req 3.1.1: Tool registered with correct Zod schema
  // ========================================================================

  describe('tool registration with correct Zod schema (Req 3.1.1)', () => {
    it('should have the correct tool name from TOOL_NAMES', () => {
      expect(plugin.name).toBe(TOOL_NAMES.SPAWN_SUBAGENT);
      expect(plugin.name).toBe('spawn-subagent');
    });

    it('should have a description string', () => {
      expect(typeof plugin.description).toBe('string');
      expect(plugin.description.length).toBeGreaterThan(0);
    });

    it('should have a Zod schema as inputSchema', () => {
      expect(plugin.inputSchema).toBeInstanceOf(z.ZodType);
    });

    it('should accept valid input with required goal field', () => {
      const result = plugin.inputSchema.safeParse({
        goal: 'Write unit tests for auth module',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.goal).toBe('Write unit tests for auth module');
      }
    });

    it('should accept input with optional agentType and systemPrompt', () => {
      const result = plugin.inputSchema.safeParse({
        goal: 'Refactor the database layer',
        agentType: 'refactoring-expert',
        systemPrompt: 'You are a database refactoring specialist.',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.goal).toBe('Refactor the database layer');
        expect(result.data.agentType).toBe('refactoring-expert');
        expect(result.data.systemPrompt).toBe('You are a database refactoring specialist.');
      }
    });

    it('should reject input with empty goal string', () => {
      const result = plugin.inputSchema.safeParse({ goal: '' });

      expect(result.success).toBe(false);
    });

    it('should reject input without goal field', () => {
      const result = plugin.inputSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('should have a requiresConfirmation function that returns true', () => {
      expect(typeof plugin.requiresConfirmation).toBe('function');
      expect(plugin.requiresConfirmation({})).toBe(true);
    });
  });

  // ========================================================================
  // Req 3.1.4: systemPrompt passed through to SubagentContext
  // ========================================================================

  describe('systemPrompt passed through to SubagentContext (Req 3.1.4)', () => {
    it('should pass systemPrompt to createSubagentContext when provided', async () => {
      const ctx = makeCtx();
      const systemPrompt = 'You are a test-writing expert.';

      await plugin.execute(
        { goal: 'Write tests', systemPrompt },
        ctx,
      );

      expect(mockCreateSubagentContext).toHaveBeenCalledTimes(1);
      expect(mockCreateSubagentContext).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt }),
      );
    });

    it('should pass undefined systemPrompt when not provided', async () => {
      const ctx = makeCtx();

      await plugin.execute({ goal: 'Do something' }, ctx);

      expect(mockCreateSubagentContext).toHaveBeenCalledTimes(1);
      const callArgs = mockCreateSubagentContext.mock.calls[0][0];
      expect(callArgs.systemPrompt).toBeUndefined();
    });

    it('should pass agentType alongside systemPrompt', async () => {
      const ctx = makeCtx();

      await plugin.execute(
        {
          goal: 'Analyse code',
          agentType: 'code-reviewer',
          systemPrompt: 'You review code for security issues.',
        },
        ctx,
      );

      expect(mockCreateSubagentContext).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'code-reviewer',
          systemPrompt: 'You review code for security issues.',
        }),
      );
    });
  });

  // ========================================================================
  // Req 3.2.5: Workspace path inherited from parent
  // ========================================================================

  describe('workspace path inherited from parent (Req 3.2.5)', () => {
    it('should pass the parent workspacePath to createSubagentContext', async () => {
      const workspacePath = '/home/user/my-project';
      const ctx = makeCtx({ workspacePath });

      await plugin.execute({ goal: 'Search for files' }, ctx);

      expect(mockCreateSubagentContext).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath }),
      );
    });

    it('should inherit different workspace paths from different parent contexts', async () => {
      const ctx1 = makeCtx({
        workspacePath: '/workspace/project-a',
        sessionId: 'session-1',
      });
      const ctx2 = makeCtx({
        workspacePath: '/workspace/project-b',
        sessionId: 'session-2',
      });

      await plugin.execute({ goal: 'Task A' }, ctx1);
      await plugin.execute({ goal: 'Task B' }, ctx2);

      expect(mockCreateSubagentContext).toHaveBeenCalledTimes(2);

      const firstCall = mockCreateSubagentContext.mock.calls[0][0];
      const secondCall = mockCreateSubagentContext.mock.calls[1][0];

      expect(firstCall.workspacePath).toBe('/workspace/project-a');
      expect(secondCall.workspacePath).toBe('/workspace/project-b');
    });

    it('should pass the parent sessionId as parentSessionId', async () => {
      const ctx = makeCtx({ sessionId: 'parent-session-42' });

      await plugin.execute({ goal: 'Sub-task' }, ctx);

      expect(mockCreateSubagentContext).toHaveBeenCalledWith(
        expect.objectContaining({ parentSessionId: 'parent-session-42' }),
      );
    });
  });

  // ========================================================================
  // Req 3.3.3: Depth resets on new top-level message
  // ========================================================================

  describe('depth resets on new top-level message (Req 3.3.3)', () => {
    it('should start with depth 0 for a new session', () => {
      expect(getDepth('fresh-session')).toBe(0);
    });

    it('should increment depth after a successful spawn', async () => {
      const ctx = makeCtx({ sessionId: 'session-1' });

      expect(getDepth('session-1')).toBe(0);

      await plugin.execute({ goal: 'First spawn' }, ctx);

      expect(getDepth('session-1')).toBe(1);
    });

    it('should reset depth to 0 when resetDepth is called', () => {
      const sessionId = 'session-1';

      // Simulate some spawns
      incrementDepth(sessionId);
      incrementDepth(sessionId);
      expect(getDepth(sessionId)).toBe(2);

      // Reset — simulates what the Orchestrator does on new top-level message
      resetDepth(sessionId);

      expect(getDepth(sessionId)).toBe(0);
    });

    it('should allow spawning again after depth reset', async () => {
      const sessionId = 'session-1';
      const ctx = makeCtx({ sessionId });

      // Push depth to the limit
      (config as Record<string, unknown>).maxSubagentDepth = 2;
      incrementDepth(sessionId);
      incrementDepth(sessionId);

      // Spawning should fail at max depth
      const rejectedResult = await plugin.execute({ goal: 'Blocked' }, ctx);
      expect(rejectedResult.success).toBe(false);

      // Reset depth (simulates new top-level message)
      resetDepth(sessionId);
      expect(getDepth(sessionId)).toBe(0);

      // Spawning should succeed again
      const acceptedResult = await plugin.execute({ goal: 'Allowed again' }, ctx);
      expect(acceptedResult.success).toBe(true);
    });

    it('should not affect other sessions when resetting depth', () => {
      incrementDepth('session-1');
      incrementDepth('session-1');
      incrementDepth('session-2');

      expect(getDepth('session-1')).toBe(2);
      expect(getDepth('session-2')).toBe(1);

      // Reset only session-1
      resetDepth('session-1');

      expect(getDepth('session-1')).toBe(0);
      expect(getDepth('session-2')).toBe(1);
    });
  });
});
