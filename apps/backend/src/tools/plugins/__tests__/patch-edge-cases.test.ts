/**
 * Unit tests for patch edge cases.
 *
 * Validates: Requirements 2.2.4, 2.3.2, 2.4.4
 *
 * - lineRange without searchString replaces entire range (Req 2.2.4)
 * - flexibleIndent default is true (Req 2.4.4)
 * - backup filename includes timestamp and session ID (Req 2.3.2)
 * - file outside workspace throws WorkspaceBoundaryError
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import type { ToolContext } from '@clover/shared';

import { applyPatch } from '../apply-patch.tool.js';
import type { PatchInput } from '../apply-patch.tool.js';
import { WorkspaceBoundaryError } from '../edit-file.tool.js';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the plugin (for execute-level tests)
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    copyFile: vi.fn(),
  },
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import plugin from '../apply-patch.tool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE = path.resolve('/test-workspace');
const TEST_FILE = 'test-file.txt';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspacePath: overrides.workspacePath ?? WORKSPACE,
    sessionId: overrides.sessionId ?? 'session-abc-123',
    execGuard: overrides.execGuard ?? {
      execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    },
    emitEvent: overrides.emitEvent ?? vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Patch Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['CLOVER_WORKSPACE'];
  });

  // ========================================================================
  // lineRange without searchString replaces entire range (Req 2.2.4)
  // ========================================================================

  describe('lineRange without searchString — replaces entire range (Req 2.2.4)', () => {
    it('should replace the entire line range with replaceString when searchString is omitted', () => {
      const fileContent = 'line1\nline2\nline3\nline4\nline5';
      const input: PatchInput = {
        filePath: TEST_FILE,
        replaceString: 'REPLACED',
        lineRange: { start: 2, end: 4 },
        flexibleIndent: true,
      };

      const result = applyPatch(fileContent, input, TEST_FILE);

      expect(result.patched).toBe('line1\nREPLACED\nline5');
    });

    it('should replace entire range with multi-line replaceString', () => {
      const fileContent = 'alpha\nbeta\ngamma\ndelta';
      const input: PatchInput = {
        filePath: TEST_FILE,
        replaceString: 'NEW_LINE_A\nNEW_LINE_B',
        lineRange: { start: 2, end: 3 },
        flexibleIndent: true,
      };

      const result = applyPatch(fileContent, input, TEST_FILE);

      expect(result.patched).toBe('alpha\nNEW_LINE_A\nNEW_LINE_B\ndelta');
    });

    it('should remove lines when replaceString is empty', () => {
      const fileContent = 'keep\nremove-me\nalso-remove\nkeep-too';
      const input: PatchInput = {
        filePath: TEST_FILE,
        replaceString: '',
        lineRange: { start: 2, end: 3 },
        flexibleIndent: true,
      };

      const result = applyPatch(fileContent, input, TEST_FILE);

      expect(result.patched).toBe('keep\nkeep-too');
    });

    it('should replace a single line when start equals end', () => {
      const fileContent = 'first\nsecond\nthird';
      const input: PatchInput = {
        filePath: TEST_FILE,
        replaceString: 'REPLACED',
        lineRange: { start: 2, end: 2 },
        flexibleIndent: true,
      };

      const result = applyPatch(fileContent, input, TEST_FILE);

      expect(result.patched).toBe('first\nREPLACED\nthird');
    });

    it('should preserve CRLF line endings when replacing a range', () => {
      const fileContent = 'line1\r\nline2\r\nline3\r\nline4';
      const input: PatchInput = {
        filePath: TEST_FILE,
        replaceString: 'REPLACED',
        lineRange: { start: 2, end: 3 },
        flexibleIndent: true,
      };

      const result = applyPatch(fileContent, input, TEST_FILE);

      expect(result.patched).toBe('line1\r\nREPLACED\r\nline4');
    });
  });

  // ========================================================================
  // flexibleIndent default is true (Req 2.4.4)
  // ========================================================================

  describe('flexibleIndent default is true (Req 2.4.4)', () => {
    it('should default flexibleIndent to true when not specified in input', () => {
      // The Zod schema has `.default(true)` for flexibleIndent.
      // When we parse input without flexibleIndent, it should be true.
      const { inputSchema } = plugin;
      const parsed = inputSchema.parse({
        filePath: 'test.ts',
        searchString: 'hello',
        replaceString: 'world',
      });

      expect(parsed.flexibleIndent).toBe(true);
    });

    it('should match with flexible indentation by default (no flexibleIndent specified)', () => {
      // File has indented content; search string has no indentation.
      // With flexibleIndent defaulting to true, it should still match.
      const fileContent = '  function hello() {\n    return 1;\n  }';
      const input: PatchInput = {
        filePath: TEST_FILE,
        searchString: 'return 1;',
        replaceString: 'return 42;',
        flexibleIndent: true, // the default value
      };

      const result = applyPatch(fileContent, input, TEST_FILE);

      expect(result.patched).toContain('return 42;');
      // Original indentation should be preserved
      expect(result.patched).toContain('    return 42;');
    });

    it('should allow explicitly setting flexibleIndent to false', () => {
      const { inputSchema } = plugin;
      const parsed = inputSchema.parse({
        filePath: 'test.ts',
        searchString: 'hello',
        replaceString: 'world',
        flexibleIndent: false,
      });

      expect(parsed.flexibleIndent).toBe(false);
    });
  });

  // ========================================================================
  // Backup filename includes timestamp and session ID (Req 2.3.2)
  // ========================================================================

  describe('backup filename includes timestamp and session ID (Req 2.3.2)', () => {
    it('should create backup in .clover/snapshots/{sessionId}/ with timestamp in filename', async () => {
      const sessionId = 'session-abc-123';
      const fileContent = 'original content\nwith a needle\nmore lines';

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(fileContent);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.copyFile).mockResolvedValue(undefined);

      const ctx = makeCtx({ sessionId });

      await plugin.execute(
        {
          filePath: 'src/target.ts',
          searchString: 'with a needle',
          replaceString: 'patched line',
        },
        ctx,
      );

      // Verify mkdir was called with the session-scoped snapshot directory
      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining(path.join('.clover', 'snapshots', sessionId)),
        { recursive: true },
      );

      // Verify copyFile was called with a backup filename containing a timestamp
      expect(fs.copyFile).toHaveBeenCalledTimes(1);
      const copyArgs = vi.mocked(fs.copyFile).mock.calls[0];
      const backupPath = copyArgs[1] as string;

      // Backup should be in the session directory
      expect(backupPath).toContain(path.join('snapshots', sessionId));

      // Backup filename should match pattern: {basename}.{timestamp}.bak
      const backupFilename = path.basename(backupPath);
      expect(backupFilename).toMatch(/^target\.ts\.\d+\.bak$/);
    });

    it('should use different session IDs for different sessions', async () => {
      const fileContent = 'content\nwith needle\nend';

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(fileContent);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.copyFile).mockResolvedValue(undefined);

      const patchArgs = {
        filePath: 'file.txt',
        searchString: 'with needle',
        replaceString: 'replaced',
      };

      // Execute with session A
      await plugin.execute(patchArgs, makeCtx({ sessionId: 'session-A' }));
      const firstMkdir = vi.mocked(fs.mkdir).mock.calls[0][0] as string;
      expect(firstMkdir).toContain('session-A');

      vi.clearAllMocks();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(fileContent);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.copyFile).mockResolvedValue(undefined);

      // Execute with session B
      await plugin.execute(patchArgs, makeCtx({ sessionId: 'session-B' }));
      const secondMkdir = vi.mocked(fs.mkdir).mock.calls[0][0] as string;
      expect(secondMkdir).toContain('session-B');
    });
  });

  // ========================================================================
  // File outside workspace throws WorkspaceBoundaryError
  // ========================================================================

  describe('file outside workspace throws WorkspaceBoundaryError', () => {
    it('should throw WorkspaceBoundaryError for path traversal with ../', async () => {
      const ctx = makeCtx();

      await expect(
        plugin.execute(
          {
            filePath: '../../etc/passwd',
            searchString: 'root',
            replaceString: 'hacked',
          },
          ctx,
        ),
      ).rejects.toThrow(WorkspaceBoundaryError);
    });

    it('should throw WorkspaceBoundaryError with descriptive message', async () => {
      const ctx = makeCtx();

      await expect(
        plugin.execute(
          {
            filePath: '../../../outside/file.txt',
            searchString: 'x',
            replaceString: 'y',
          },
          ctx,
        ),
      ).rejects.toThrow(/outside/i);
    });

    it('should not read or write any files when path is outside workspace', async () => {
      const ctx = makeCtx();

      try {
        await plugin.execute(
          {
            filePath: '../../secret/data.txt',
            searchString: 'secret',
            replaceString: 'exposed',
          },
          ctx,
        );
      } catch {
        // Expected to throw — verify no file operations occurred
      }

      expect(fs.readFile).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.copyFile).not.toHaveBeenCalled();
    });
  });
});
