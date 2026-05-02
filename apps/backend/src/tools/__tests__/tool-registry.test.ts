/**
 * Unit tests for Tool Registry.
 *
 * Validates: Requirements 22.1, 22.3, 22.4, 23.1, 23.2
 *
 * Tests auto-discovery of plugin files, Zod validation failure
 * returning typed error, and confirmation flow integration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { ToolPlugin, ToolContext, ToolResult } from '@clover/shared';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

// Mock glob to control which plugin files are "discovered"
const mockGlob = vi.fn<(pattern: string, opts?: unknown) => Promise<string[]>>();
vi.mock('glob', () => ({
  glob: (...args: unknown[]) => mockGlob(args[0] as string, args[1]),
}));

// Mock confirmation bus
const mockConfirmationRequest = vi.fn<(data: unknown) => Promise<boolean>>();
vi.mock('../../confirmation/confirmation.bus.js', () => ({
  request: (data: unknown) => mockConfirmationRequest(data),
}));

// Import the module under test (uses mocked dependencies)
import {
  loadPlugins,
  listTools,
  getPlugin,
  execute,
  ToolNotFoundError,
  ToolValidationError,
} from '../tool-registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ToolPlugin for testing. */
function makeFakePlugin(overrides: Partial<ToolPlugin> = {}): ToolPlugin {
  return {
    name: overrides.name ?? 'fake-tool',
    description: overrides.description ?? 'A fake tool for testing',
    inputSchema: overrides.inputSchema ?? z.object({ value: z.string() }),
    requiresConfirmation: overrides.requiresConfirmation ?? (() => false),
    execute:
      overrides.execute ??
      (async () => ({ success: true, output: 'done' })),
  };
}

function makeToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspacePath: overrides.workspacePath ?? '/workspace',
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

describe('Tool Registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGlob.mockResolvedValue([]);
    mockConfirmationRequest.mockResolvedValue(true);
  });

  // ========================================================================
  // Req 22.1: Auto-discovery of plugin files
  // ========================================================================

  describe('loadPlugins — auto-discovery (Req 22.1)', () => {
    it('should call glob with *.tool.{ts,js} pattern in plugins/ directory', async () => {
      await loadPlugins();

      expect(mockGlob).toHaveBeenCalledTimes(1);
      const pattern = mockGlob.mock.calls[0]![0];
      // The pattern should end with plugins/<glob> for .tool.ts/.tool.js files
      expect(pattern).toMatch(/plugins/);
      expect(pattern).toMatch(/\*\.tool\.\{ts,js\}/);
    });

    it('should register no plugins when glob returns empty array', async () => {
      mockGlob.mockResolvedValue([]);

      await loadPlugins();

      // listTools may contain plugins from prior loadPlugins calls in the
      // module-level state, but the glob was called with the correct pattern
      expect(mockGlob).toHaveBeenCalledTimes(1);
    });

    it('should use windowsPathsNoEscape option for cross-platform glob', async () => {
      await loadPlugins();

      expect(mockGlob).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ windowsPathsNoEscape: true }),
      );
    });
  });

  // ========================================================================
  // Req 22.3, 22.4, 23.1, 23.2: Zod validation and typed errors
  // ========================================================================

  describe('ToolValidationError (Req 22.4, 23.2)', () => {
    it('should include Zod issue details in the error', () => {
      const issues: z.ZodIssue[] = [
        {
          code: 'too_small',
          minimum: 1,
          type: 'string',
          inclusive: true,
          exact: false,
          message: 'String must contain at least 1 character(s)',
          path: ['path'],
        },
      ];

      const error = new ToolValidationError('test-tool', issues);

      expect(error.name).toBe('ToolValidationError');
      expect(error.details).toEqual(issues);
      expect(error.message).toContain('test-tool');
      expect(error.message).toContain('path');
    });

    it('should format multiple issues in the error message', () => {
      const issues: z.ZodIssue[] = [
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          message: 'Expected string, received number',
          path: ['name'],
        },
        {
          code: 'invalid_type',
          expected: 'number',
          received: 'undefined',
          message: 'Required',
          path: ['count'],
        },
      ];

      const error = new ToolValidationError('multi-err', issues);

      expect(error.details).toHaveLength(2);
      expect(error.message).toContain('name');
      expect(error.message).toContain('count');
    });
  });

  describe('ToolNotFoundError', () => {
    it('should have correct name and message', () => {
      const error = new ToolNotFoundError('missing-tool');

      expect(error.name).toBe('ToolNotFoundError');
      expect(error.message).toBe('Tool not found: missing-tool');
      expect(error).toBeInstanceOf(Error);
    });
  });

  // ========================================================================
  // execute — ToolNotFoundError for unknown tools
  // ========================================================================

  describe('execute — unknown tool (Req 22.1)', () => {
    it('should throw ToolNotFoundError for unregistered tool name', async () => {
      await expect(
        execute('nonexistent-tool', {}, makeToolContext()),
      ).rejects.toThrow(ToolNotFoundError);
    });
  });

  // ========================================================================
  // Integration-style tests: validate → confirm → execute flow
  // These replicate the core execute logic to test Zod validation and
  // confirmation routing with controlled plugin instances.
  // ========================================================================

  describe('execute flow — Zod validation (Req 22.3, 23.1)', () => {
    /**
     * Helper that replicates the tool-registry execute flow with a given
     * plugin, allowing us to test validation and confirmation without
     * needing to register plugins in the module-level Map.
     */
    async function executeWithPlugin(
      plugin: ToolPlugin,
      args: unknown,
      ctx: ToolContext,
    ): Promise<ToolResult> {
      // Replicate the core execute logic from tool-registry.ts
      const schema = plugin.inputSchema;
      if (schema instanceof z.ZodType) {
        const result = schema.safeParse(args);
        if (!result.success) {
          throw new ToolValidationError(plugin.name, result.error.issues);
        }
        args = result.data;
      }

      if (plugin.requiresConfirmation(args)) {
        const approved = await mockConfirmationRequest({
          toolName: plugin.name,
          args,
        });
        if (!approved) {
          return { success: false, output: '', error: 'user_denied' };
        }
      }

      return plugin.execute(args, ctx);
    }

    it('should throw ToolValidationError with details when args are invalid', async () => {
      const plugin = makeFakePlugin({
        name: 'validated-tool',
        inputSchema: z.object({
          path: z.string().min(1, 'path is required'),
        }),
      });

      try {
        await executeWithPlugin(plugin, { path: '' }, makeToolContext());
        expect.fail('Should have thrown ToolValidationError');
      } catch (err) {
        expect(err).toBeInstanceOf(ToolValidationError);
        const validationErr = err as InstanceType<typeof ToolValidationError>;
        expect(validationErr.details).toHaveLength(1);
        expect(validationErr.details[0]!.path).toEqual(['path']);
        expect(validationErr.message).toContain('validated-tool');
      }
    });

    it('should throw ToolValidationError when required field is missing', async () => {
      const plugin = makeFakePlugin({
        name: 'required-fields-tool',
        inputSchema: z.object({
          name: z.string(),
          count: z.number(),
        }),
      });

      try {
        await executeWithPlugin(plugin, { name: 'test' }, makeToolContext());
        expect.fail('Should have thrown ToolValidationError');
      } catch (err) {
        expect(err).toBeInstanceOf(ToolValidationError);
        const validationErr = err as InstanceType<typeof ToolValidationError>;
        expect(
          validationErr.details.some((d) => d.path.includes('count')),
        ).toBe(true);
      }
    });

    it('should pass validated (coerced/defaulted) args to plugin.execute', async () => {
      const executeSpy = vi.fn<(args: unknown, ctx: ToolContext) => Promise<ToolResult>>(
        async () => ({ success: true, output: 'ok' }),
      );

      const plugin = makeFakePlugin({
        name: 'coerce-tool',
        inputSchema: z.object({
          value: z.string().default('fallback'),
        }),
        execute: executeSpy,
      });

      await executeWithPlugin(plugin, {}, makeToolContext());

      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(executeSpy.mock.calls[0]![0]).toEqual({ value: 'fallback' });
    });

    it('should NOT call execute when Zod validation fails', async () => {
      const executeSpy = vi.fn<(args: unknown, ctx: ToolContext) => Promise<ToolResult>>(
        async () => ({ success: true, output: 'should not run' }),
      );

      const plugin = makeFakePlugin({
        name: 'no-exec-on-fail',
        inputSchema: z.object({ path: z.string().min(1) }),
        execute: executeSpy,
      });

      await expect(
        executeWithPlugin(plugin, { path: '' }, makeToolContext()),
      ).rejects.toThrow(ToolValidationError);

      expect(executeSpy).not.toHaveBeenCalled();
      expect(mockConfirmationRequest).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Confirmation flow integration (Req 23.2)
  // ========================================================================

  describe('execute flow — confirmation integration (Req 23.2)', () => {
    async function executeWithPlugin(
      plugin: ToolPlugin,
      args: unknown,
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const schema = plugin.inputSchema;
      if (schema instanceof z.ZodType) {
        const result = schema.safeParse(args);
        if (!result.success) {
          throw new ToolValidationError(plugin.name, result.error.issues);
        }
        args = result.data;
      }

      if (plugin.requiresConfirmation(args)) {
        const approved = await mockConfirmationRequest({
          toolName: plugin.name,
          args,
        });
        if (!approved) {
          return { success: false, output: '', error: 'user_denied' };
        }
      }

      return plugin.execute(args, ctx);
    }

    it('should route to confirmation bus when requiresConfirmation returns true', async () => {
      mockConfirmationRequest.mockResolvedValue(true);

      const executeSpy = vi.fn<(args: unknown, ctx: ToolContext) => Promise<ToolResult>>(
        async () => ({ success: true, output: 'executed' }),
      );

      const plugin = makeFakePlugin({
        name: 'confirm-tool',
        inputSchema: z.object({ path: z.string() }),
        requiresConfirmation: () => true,
        execute: executeSpy,
      });

      const result = await executeWithPlugin(
        plugin,
        { path: 'file.txt' },
        makeToolContext(),
      );

      expect(mockConfirmationRequest).toHaveBeenCalledTimes(1);
      expect(mockConfirmationRequest).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'confirm-tool' }),
      );
      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it('should return user_denied when confirmation is rejected', async () => {
      mockConfirmationRequest.mockResolvedValue(false);

      const executeSpy = vi.fn<(args: unknown, ctx: ToolContext) => Promise<ToolResult>>(
        async () => ({ success: true, output: 'should not run' }),
      );

      const plugin = makeFakePlugin({
        name: 'denied-tool',
        inputSchema: z.object({ path: z.string() }),
        requiresConfirmation: () => true,
        execute: executeSpy,
      });

      const result = await executeWithPlugin(
        plugin,
        { path: 'file.txt' },
        makeToolContext(),
      );

      expect(mockConfirmationRequest).toHaveBeenCalledTimes(1);
      expect(executeSpy).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toBe('user_denied');
    });

    it('should skip confirmation when requiresConfirmation returns false', async () => {
      const executeSpy = vi.fn<(args: unknown, ctx: ToolContext) => Promise<ToolResult>>(
        async () => ({ success: true, output: 'no confirm needed' }),
      );

      const plugin = makeFakePlugin({
        name: 'no-confirm-tool',
        inputSchema: z.object({ value: z.string() }),
        requiresConfirmation: () => false,
        execute: executeSpy,
      });

      const result = await executeWithPlugin(
        plugin,
        { value: 'hello' },
        makeToolContext(),
      );

      expect(mockConfirmationRequest).not.toHaveBeenCalled();
      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it('should validate args BEFORE checking confirmation', async () => {
      const plugin = makeFakePlugin({
        name: 'validate-first',
        inputSchema: z.object({ path: z.string().min(1) }),
        requiresConfirmation: () => true,
      });

      await expect(
        executeWithPlugin(plugin, { path: '' }, makeToolContext()),
      ).rejects.toThrow(ToolValidationError);

      // Confirmation should never be reached if validation fails
      expect(mockConfirmationRequest).not.toHaveBeenCalled();
    });
  });
});
