/**
 * Integration tests for file operations with confirmation.
 *
 * Validates: Requirements 3.3, 4.1, 4.2, 4.3, 19.1
 *
 * Tests the full pipeline:
 *   Tool Registry receives tool call → checks requiresConfirmation →
 *   Confirmation Bus emits confirmation:request → user approves/denies →
 *   tool executes or returns user_denied
 *
 * The filesystem (node:fs) is mocked. The confirmation bus is spied on
 * to simulate user responses. Tool registry and plugins are wired
 * together with real logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { ToolPlugin, ToolContext, ToolResult } from '@clover/shared';

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE importing modules under test
// ---------------------------------------------------------------------------

// 1. Mock node:fs/promises for file operations
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
  },
}));

// 2. Mock node:fs for existsSync (used by write-file requiresConfirmation)
const mockExistsSync = vi.fn<(p: string) => boolean>();
vi.mock('node:fs', () => ({
  existsSync: (p: string) => mockExistsSync(p),
}));

// 3. Mock config module for confirmation bus timeout
vi.mock('../../config/config.js', () => ({
  config: {
    confirmation: { timeoutMs: 60_000 },
  },
}));

// 4. Mock glob so tool-registry.loadPlugins doesn't scan the filesystem
vi.mock('glob', () => ({
  glob: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Import modules under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import * as confirmationBus from '../../confirmation/confirmation.bus.js';
import writeFilePlugin from '../../tools/plugins/write-file.tool.js';
import deleteFilePlugin from '../../tools/plugins/delete-file.tool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE = path.resolve('/test-workspace');

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspacePath: overrides.workspacePath ?? WORKSPACE,
    sessionId: overrides.sessionId ?? 'session-1',
    execGuard: overrides.execGuard ?? {
      execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    },
    emitEvent: overrides.emitEvent ?? vi.fn(),
  };
}

/**
 * Execute a tool through the full confirmation flow, replicating the
 * tool-registry.execute() pipeline with real plugin instances:
 *
 * 1. Validate args with Zod schema
 * 2. Check requiresConfirmation
 * 3. Route through confirmation bus if needed
 * 4. Execute the plugin or return user_denied
 *
 * The confirmationBus.request is spied on externally to control
 * approval/denial behavior.
 */
async function executeWithConfirmation(
  plugin: ToolPlugin,
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  // Zod validation (same as tool-registry)
  const schema = plugin.inputSchema;
  if (schema instanceof z.ZodType) {
    const result = schema.safeParse(args);
    if (!result.success) {
      throw new Error(`Validation failed: ${result.error.message}`);
    }
    args = result.data;
  }

  // Confirmation check (same as tool-registry)
  if (plugin.requiresConfirmation(args)) {
    const requestId = randomUUID();
    const approved = await confirmationBus.request({
      requestId,
      toolName: plugin.name,
      operation: plugin.name,
      details: `Executing tool "${plugin.name}" with provided arguments`,
      args,
    });

    if (!approved) {
      return { success: false, output: '', error: 'user_denied' };
    }
  }

  // Execute the plugin
  return plugin.execute(args, ctx);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('File Operations with Confirmation — Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear CLOVER_WORKSPACE so plugins use ctx.workspacePath
    delete process.env['CLOVER_WORKSPACE'];
  });

  // ========================================================================
  // write-file overwrite: confirmation → approval → file created (Req 3.3, 19.1)
  // ========================================================================

  describe('write-file overwrite with confirmation', () => {
    it('should request confirmation, approve, and write file successfully (Req 3.3, 4.2, 19.1)', async () => {
      // Arrange
      process.env['CLOVER_WORKSPACE'] = WORKSPACE;
      mockExistsSync.mockReturnValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const args = { path: 'src/existing.ts', content: 'updated content' };
      const ctx = makeCtx();

      // Mock confirmationBus.request to immediately return approved
      const requestSpy = vi.spyOn(confirmationBus, 'request')
        .mockResolvedValue(true);

      // Act
      const result = await executeWithConfirmation(writeFilePlugin, args, ctx);

      // Assert: file was written
      expect(result.success).toBe(true);
      expect(result.output).toContain('existing.ts');
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.resolve(WORKSPACE, 'src/existing.ts'),
        'updated content',
        'utf-8',
      );

      // Assert: confirmation was requested with correct tool name
      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(requestSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'write-file',
          args: { path: 'src/existing.ts', content: 'updated content' },
        }),
      );

      requestSpy.mockRestore();
    });

    it('should return user_denied when overwrite confirmation is denied (Req 3.3, 19.1)', async () => {
      // Arrange
      process.env['CLOVER_WORKSPACE'] = WORKSPACE;
      mockExistsSync.mockReturnValue(true);

      const args = { path: 'src/existing.ts', content: 'should not write' };
      const ctx = makeCtx();

      // Mock confirmationBus.request to return denied
      const requestSpy = vi.spyOn(confirmationBus, 'request')
        .mockResolvedValue(false);

      // Act
      const result = await executeWithConfirmation(writeFilePlugin, args, ctx);

      // Assert: user_denied returned, file NOT written
      expect(result.success).toBe(false);
      expect(result.error).toBe('user_denied');
      expect(fs.writeFile).not.toHaveBeenCalled();

      // Assert: confirmation was still requested
      expect(requestSpy).toHaveBeenCalledTimes(1);

      requestSpy.mockRestore();
    });

    it('should NOT trigger confirmation for new file creation (Req 3.3)', async () => {
      // Arrange: file does NOT exist → requiresConfirmation returns false
      process.env['CLOVER_WORKSPACE'] = WORKSPACE;
      mockExistsSync.mockReturnValue(false);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const args = { path: 'src/brand-new.ts', content: 'new file content' };
      const ctx = makeCtx();

      // Verify requiresConfirmation returns false for new file
      expect(writeFilePlugin.requiresConfirmation(args)).toBe(false);

      // Spy on confirmationBus.request — should NOT be called
      const requestSpy = vi.spyOn(confirmationBus, 'request');

      // Act
      const result = await executeWithConfirmation(writeFilePlugin, args, ctx);

      // Assert: file created without confirmation
      expect(result.success).toBe(true);
      expect(requestSpy).not.toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.resolve(WORKSPACE, 'src/brand-new.ts'),
        'new file content',
        'utf-8',
      );

      requestSpy.mockRestore();
    });
  });

  // ========================================================================
  // delete-file: confirmation → approval → file deleted (Req 4.1, 4.2)
  // ========================================================================

  describe('delete-file with confirmation', () => {
    it('should always require confirmation for delete operations (Req 4.1)', () => {
      expect(deleteFilePlugin.requiresConfirmation({})).toBe(true);
      expect(deleteFilePlugin.requiresConfirmation({ path: 'any.ts' })).toBe(true);
    });

    it('should request confirmation, approve, and delete file successfully (Req 4.1, 4.2)', async () => {
      // Arrange
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      const args = { path: 'src/to-delete.ts' };
      const ctx = makeCtx();

      // Mock confirmationBus.request to return approved
      const requestSpy = vi.spyOn(confirmationBus, 'request')
        .mockResolvedValue(true);

      // Act
      const result = await executeWithConfirmation(deleteFilePlugin, args, ctx);

      // Assert: file was deleted
      expect(result.success).toBe(true);
      expect(result.output).toContain('to-delete.ts');
      expect(fs.unlink).toHaveBeenCalledWith(
        path.resolve(WORKSPACE, 'src/to-delete.ts'),
      );

      // Assert: confirmation was requested with correct tool name
      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(requestSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'delete-file',
        }),
      );

      requestSpy.mockRestore();
    });

    it('should return user_denied and preserve file when deletion is denied (Req 4.3)', async () => {
      // Arrange
      const args = { path: 'src/precious-file.ts' };
      const ctx = makeCtx();

      // Mock confirmationBus.request to return denied
      const requestSpy = vi.spyOn(confirmationBus, 'request')
        .mockResolvedValue(false);

      // Act
      const result = await executeWithConfirmation(deleteFilePlugin, args, ctx);

      // Assert: user_denied returned, file NOT deleted
      expect(result.success).toBe(false);
      expect(result.error).toBe('user_denied');
      expect(fs.unlink).not.toHaveBeenCalled();

      requestSpy.mockRestore();
    });

    it('should emit confirmation:request with requestId, toolName, and args (Req 19.1)', async () => {
      // Arrange
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      const args = { path: 'src/file-to-confirm.ts' };
      const ctx = makeCtx();

      // Capture the confirmation request data
      let capturedRequest: confirmationBus.ConfirmationRequest | undefined;
      const requestSpy = vi.spyOn(confirmationBus, 'request')
        .mockImplementation(async (data) => {
          capturedRequest = data;
          return true;
        });

      // Act
      await executeWithConfirmation(deleteFilePlugin, args, ctx);

      // Assert: confirmation request contains expected fields
      expect(capturedRequest).toBeDefined();
      expect(capturedRequest!.requestId).toBeTruthy();
      expect(typeof capturedRequest!.requestId).toBe('string');
      expect(capturedRequest!.toolName).toBe('delete-file');
      expect(capturedRequest!.operation).toBe('delete-file');
      expect(capturedRequest!.args).toEqual(args);
      expect(capturedRequest!.details).toBeTruthy();

      requestSpy.mockRestore();
    });
  });

  // ========================================================================
  // End-to-end: full confirmation flow for both operations
  // ========================================================================

  describe('end-to-end confirmation flow', () => {
    it('should handle write-overwrite approval followed by delete denial in sequence', async () => {
      // Arrange
      process.env['CLOVER_WORKSPACE'] = WORKSPACE;
      mockExistsSync.mockReturnValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const ctx = makeCtx();

      // First call: approve (write-overwrite), second call: deny (delete)
      const requestSpy = vi.spyOn(confirmationBus, 'request')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      // Step 1: Write-overwrite (should succeed with approval)
      const writeResult = await executeWithConfirmation(
        writeFilePlugin,
        { path: 'src/file.ts', content: 'overwritten' },
        ctx,
      );

      expect(writeResult.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalled();

      // Step 2: Delete (should be denied)
      const deleteResult = await executeWithConfirmation(
        deleteFilePlugin,
        { path: 'src/file.ts' },
        ctx,
      );

      expect(deleteResult.success).toBe(false);
      expect(deleteResult.error).toBe('user_denied');
      expect(fs.unlink).not.toHaveBeenCalled();

      // Both operations triggered confirmation
      expect(requestSpy).toHaveBeenCalledTimes(2);
      expect(requestSpy.mock.calls[0]![0]).toMatchObject({ toolName: 'write-file' });
      expect(requestSpy.mock.calls[1]![0]).toMatchObject({ toolName: 'delete-file' });

      requestSpy.mockRestore();
    });
  });
});
