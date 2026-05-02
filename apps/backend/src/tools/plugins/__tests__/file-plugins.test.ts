/**
 * Unit tests for file operation plugins (read-file, write-file, edit-file, delete-file).
 *
 * Validates: Requirements 3.5, 3.6, 4.1, 4.3
 *
 * - Workspace boundary enforcement on read-file and write-file (Req 3.6)
 * - AmbiguousMatchError on edit-file (Req 3.5)
 * - delete-file confirmation flow (Req 4.1, 4.3)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import type { ToolContext } from '@clover/shared';

// ---------------------------------------------------------------------------
// Mocks — declared before importing modules under test
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
  },
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Import plugins under test
import readFilePlugin, {
  WorkspaceBoundaryError as ReadBoundaryError,
} from '../read-file.tool.js';

import writeFilePlugin, {
  WorkspaceBoundaryError as WriteBoundaryError,
} from '../write-file.tool.js';

import editFilePlugin, {
  AmbiguousMatchError,
  WorkspaceBoundaryError as EditBoundaryError,
} from '../edit-file.tool.js';

import deleteFilePlugin, {
  WorkspaceBoundaryError as DeleteBoundaryError,
} from '../delete-file.tool.js';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('File Operation Plugins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear CLOVER_WORKSPACE so plugins use ctx.workspacePath
    delete process.env['CLOVER_WORKSPACE'];
  });

  // ========================================================================
  // read-file: Workspace Boundary Enforcement (Req 3.6)
  // ========================================================================

  describe('read-file — workspace boundary enforcement (Req 3.6)', () => {
    it('should read a file within the workspace successfully', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('file content');

      const result = await readFilePlugin.execute(
        { path: 'src/index.ts' },
        makeCtx(),
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('file content');
      expect(fs.readFile).toHaveBeenCalledWith(
        path.resolve(WORKSPACE, 'src/index.ts'),
        'utf-8',
      );
    });

    it('should throw WorkspaceBoundaryError for path traversal with ../', async () => {
      await expect(
        readFilePlugin.execute({ path: '../../etc/passwd' }, makeCtx()),
      ).rejects.toThrow(ReadBoundaryError);

      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('should throw WorkspaceBoundaryError for absolute path outside workspace', async () => {
      await expect(
        readFilePlugin.execute({ path: '/etc/passwd' }, makeCtx()),
      ).rejects.toThrow(ReadBoundaryError);

      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('should allow reading a file at the workspace root', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('root file');

      const result = await readFilePlugin.execute(
        { path: 'README.md' },
        makeCtx(),
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('root file');
    });

    it('should return error result when file does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(
        new Error('ENOENT: no such file or directory'),
      );

      const result = await readFilePlugin.execute(
        { path: 'missing.txt' },
        makeCtx(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('should never require confirmation (read-only)', () => {
      expect(readFilePlugin.requiresConfirmation({})).toBe(false);
    });
  });

  // ========================================================================
  // write-file: Workspace Boundary Enforcement (Req 3.6)
  // ========================================================================

  describe('write-file — workspace boundary enforcement (Req 3.6)', () => {
    it('should write a file within the workspace successfully', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await writeFilePlugin.execute(
        { path: 'src/new-file.ts', content: 'hello' },
        makeCtx(),
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('new-file.ts');
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.resolve(WORKSPACE, 'src/new-file.ts'),
        'hello',
        'utf-8',
      );
    });

    it('should throw WorkspaceBoundaryError for path traversal with ../', async () => {
      await expect(
        writeFilePlugin.execute(
          { path: '../../../tmp/evil.sh', content: 'bad' },
          makeCtx(),
        ),
      ).rejects.toThrow(WriteBoundaryError);

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should throw WorkspaceBoundaryError for absolute path outside workspace', async () => {
      await expect(
        writeFilePlugin.execute(
          { path: '/tmp/evil.sh', content: 'bad' },
          makeCtx(),
        ),
      ).rejects.toThrow(WriteBoundaryError);

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should require confirmation when file already exists (overwrite)', () => {
      // Set CLOVER_WORKSPACE so requiresConfirmation can resolve the path
      process.env['CLOVER_WORKSPACE'] = WORKSPACE;
      vi.mocked(existsSync).mockReturnValue(true);

      const needsConfirm = writeFilePlugin.requiresConfirmation({
        path: 'existing.ts',
        content: 'new content',
      });

      expect(needsConfirm).toBe(true);
    });

    it('should NOT require confirmation for new file creation', () => {
      process.env['CLOVER_WORKSPACE'] = WORKSPACE;
      vi.mocked(existsSync).mockReturnValue(false);

      const needsConfirm = writeFilePlugin.requiresConfirmation({
        path: 'brand-new.ts',
        content: 'content',
      });

      expect(needsConfirm).toBe(false);
    });

    it('should create parent directories when writing', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await writeFilePlugin.execute(
        { path: 'deep/nested/dir/file.ts', content: 'content' },
        makeCtx(),
      );

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('deep'),
        { recursive: true },
      );
    });
  });

  // ========================================================================
  // edit-file: AmbiguousMatchError (Req 3.5)
  // ========================================================================

  describe('edit-file — AmbiguousMatchError (Req 3.5)', () => {
    it('should throw AmbiguousMatchError when pattern matches multiple locations', async () => {
      const fileContent = 'const x = 1;\nconst x = 1;\nconst y = 2;';
      vi.mocked(fs.readFile).mockResolvedValue(fileContent);

      await expect(
        editFilePlugin.execute(
          {
            mode: 'string-replacement',
            path: 'src/file.ts',
            oldStr: 'const x = 1;',
            newStr: 'const x = 42;',
          },
          makeCtx(),
        ),
      ).rejects.toThrow(AmbiguousMatchError);

      // File should NOT be modified
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should include match count in AmbiguousMatchError', async () => {
      const fileContent = 'foo\nfoo\nfoo\nbar';
      vi.mocked(fs.readFile).mockResolvedValue(fileContent);

      try {
        await editFilePlugin.execute(
          {
            mode: 'string-replacement',
            path: 'src/file.ts',
            oldStr: 'foo',
            newStr: 'baz',
          },
          makeCtx(),
        );
        expect.fail('Should have thrown AmbiguousMatchError');
      } catch (err) {
        expect(err).toBeInstanceOf(AmbiguousMatchError);
        const ambiguousErr = err as AmbiguousMatchError;
        expect(ambiguousErr.matchCount).toBe(3);
        expect(ambiguousErr.message).toContain('3');
      }
    });

    it('should succeed when pattern matches exactly once', async () => {
      const fileContent = 'const x = 1;\nconst y = 2;';
      vi.mocked(fs.readFile).mockResolvedValue(fileContent);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await editFilePlugin.execute(
        {
          mode: 'string-replacement',
          path: 'src/file.ts',
          oldStr: 'const x = 1;',
          newStr: 'const x = 42;',
        },
        makeCtx(),
      );

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.resolve(WORKSPACE, 'src/file.ts'),
        'const x = 42;\nconst y = 2;',
        'utf-8',
      );
    });

    it('should return error when pattern is not found', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('some content');

      const result = await editFilePlugin.execute(
        {
          mode: 'string-replacement',
          path: 'src/file.ts',
          oldStr: 'nonexistent pattern',
          newStr: 'replacement',
        },
        makeCtx(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should throw WorkspaceBoundaryError for path outside workspace', async () => {
      await expect(
        editFilePlugin.execute(
          {
            mode: 'string-replacement',
            path: '../../etc/hosts',
            oldStr: 'old',
            newStr: 'new',
          },
          makeCtx(),
        ),
      ).rejects.toThrow(EditBoundaryError);
    });

    it('should not require confirmation (patches are non-destructive)', () => {
      expect(editFilePlugin.requiresConfirmation({})).toBe(false);
    });
  });

  // ========================================================================
  // delete-file: Confirmation Flow (Req 4.1, 4.3)
  // ========================================================================

  describe('delete-file — confirmation flow (Req 4.1, 4.3)', () => {
    it('should always require confirmation (destructive operation)', () => {
      expect(deleteFilePlugin.requiresConfirmation({})).toBe(true);
      expect(
        deleteFilePlugin.requiresConfirmation({ path: 'any-file.ts' }),
      ).toBe(true);
    });

    it('should delete file within workspace when executed', async () => {
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      const result = await deleteFilePlugin.execute(
        { path: 'src/old-file.ts' },
        makeCtx(),
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('old-file.ts');
      expect(fs.unlink).toHaveBeenCalledWith(
        path.resolve(WORKSPACE, 'src/old-file.ts'),
      );
    });

    it('should return error result when file does not exist', async () => {
      vi.mocked(fs.unlink).mockRejectedValue(
        new Error('ENOENT: no such file or directory'),
      );

      const result = await deleteFilePlugin.execute(
        { path: 'missing.txt' },
        makeCtx(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('should throw WorkspaceBoundaryError for path outside workspace', async () => {
      await expect(
        deleteFilePlugin.execute(
          { path: '../../etc/important-file' },
          makeCtx(),
        ),
      ).rejects.toThrow(DeleteBoundaryError);

      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it('should confirm the user_denied flow works with tool-registry pattern', () => {
      // Verify the plugin's requiresConfirmation always returns true,
      // which means the tool-registry will always route through
      // confirmation bus. When denied, tool-registry returns user_denied.
      // This test validates the contract that enables Req 4.3.
      const needsConfirm = deleteFilePlugin.requiresConfirmation({
        path: 'any-file',
      });
      expect(needsConfirm).toBe(true);

      // The tool-registry (tested separately) handles the actual
      // user_denied response when confirmation is rejected.
    });
  });
});
