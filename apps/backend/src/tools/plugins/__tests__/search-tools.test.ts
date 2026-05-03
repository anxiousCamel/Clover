/**
 * Unit tests for search tools (search-files, grep-text).
 *
 * Validates: Requirements 4.1.1, 4.2.1, 4.3.3
 *
 * - Tool registration with correct schemas (Req 4.1.1, 4.2.1)
 * - Summary line on truncated results (Req 4.3.3)
 * - Invalid regex returns InvalidRegexError
 * - Invalid glob returns InvalidGlobError
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import path from 'node:path';
import type { ToolContext } from '@clover/shared';
import { TOOL_NAMES } from '@clover/shared';
import { InvalidRegexError } from '../../../errors/search-errors.js';
import { InvalidGlobError } from '../../../errors/search-errors.js';

// ---------------------------------------------------------------------------
// Mocks — declared before importing modules under test
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
}));

vi.mock('glob', () => ({
  glob: vi.fn(),
}));

import fs from 'node:fs/promises';
import { glob } from 'glob';

// Import plugins under test
import searchFilesPlugin from '../search-files.tool.js';
import grepTextPlugin from '../grep-text.tool.js';

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

describe('Search Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['CLOVER_WORKSPACE'];

    // Default: no .gitignore file
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
  });

  // ========================================================================
  // search-files: Tool registration with correct schema (Req 4.1.1)
  // ========================================================================

  describe('search-files — tool registration (Req 4.1.1)', () => {
    it('should have the correct tool name from TOOL_NAMES', () => {
      expect(searchFilesPlugin.name).toBe(TOOL_NAMES.SEARCH_FILES);
      expect(searchFilesPlugin.name).toBe('search-files');
    });

    it('should have a non-empty description string', () => {
      expect(typeof searchFilesPlugin.description).toBe('string');
      expect(searchFilesPlugin.description.length).toBeGreaterThan(0);
    });

    it('should have a Zod schema as inputSchema', () => {
      expect(searchFilesPlugin.inputSchema).toBeInstanceOf(z.ZodType);
    });

    it('should accept valid input with required pattern field', () => {
      const schema = searchFilesPlugin.inputSchema as z.ZodType;
      const result = schema.safeParse({ pattern: '**/*.ts' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pattern).toBe('**/*.ts');
        // Defaults
        expect(result.data.maxResults).toBe(100);
        expect(result.data.offset).toBe(0);
      }
    });

    it('should accept input with optional maxResults and offset', () => {
      const schema = searchFilesPlugin.inputSchema as z.ZodType;
      const result = schema.safeParse({
        pattern: '**/*.test.ts',
        maxResults: 25,
        offset: 10,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxResults).toBe(25);
        expect(result.data.offset).toBe(10);
      }
    });

    it('should reject input with empty pattern string', () => {
      const schema = searchFilesPlugin.inputSchema as z.ZodType;
      const result = schema.safeParse({ pattern: '' });

      expect(result.success).toBe(false);
    });

    it('should reject input without pattern field', () => {
      const schema = searchFilesPlugin.inputSchema as z.ZodType;
      const result = schema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('should never require confirmation (read-only operation)', () => {
      expect(searchFilesPlugin.requiresConfirmation({})).toBe(false);
    });
  });

  // ========================================================================
  // grep-text: Tool registration with correct schema (Req 4.2.1)
  // ========================================================================

  describe('grep-text — tool registration (Req 4.2.1)', () => {
    it('should have the correct tool name from TOOL_NAMES', () => {
      expect(grepTextPlugin.name).toBe(TOOL_NAMES.GREP_TEXT);
      expect(grepTextPlugin.name).toBe('grep-text');
    });

    it('should have a non-empty description string', () => {
      expect(typeof grepTextPlugin.description).toBe('string');
      expect(grepTextPlugin.description.length).toBeGreaterThan(0);
    });

    it('should have a Zod schema as inputSchema', () => {
      expect(grepTextPlugin.inputSchema).toBeInstanceOf(z.ZodType);
    });

    it('should accept valid input with required query field', () => {
      const schema = grepTextPlugin.inputSchema as z.ZodType;
      const result = schema.safeParse({ query: 'function\\s+\\w+' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query).toBe('function\\s+\\w+');
        // Defaults
        expect(result.data.caseSensitive).toBe(false);
        expect(result.data.maxResults).toBe(50);
        expect(result.data.offset).toBe(0);
      }
    });

    it('should accept input with all optional fields', () => {
      const schema = grepTextPlugin.inputSchema as z.ZodType;
      const result = schema.safeParse({
        query: 'TODO',
        includePattern: '**/*.ts',
        caseSensitive: true,
        maxResults: 20,
        offset: 5,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includePattern).toBe('**/*.ts');
        expect(result.data.caseSensitive).toBe(true);
        expect(result.data.maxResults).toBe(20);
        expect(result.data.offset).toBe(5);
      }
    });

    it('should reject input with empty query string', () => {
      const schema = grepTextPlugin.inputSchema as z.ZodType;
      const result = schema.safeParse({ query: '' });

      expect(result.success).toBe(false);
    });

    it('should reject input without query field', () => {
      const schema = grepTextPlugin.inputSchema as z.ZodType;
      const result = schema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('should never require confirmation (read-only operation)', () => {
      expect(grepTextPlugin.requiresConfirmation({})).toBe(false);
    });
  });

  // ========================================================================
  // grep-text: Summary line on truncated results (Req 4.3.3)
  // ========================================================================

  describe('grep-text — summary line on truncated results (Req 4.3.3)', () => {
    it('should include a summary line when results are truncated', async () => {
      // Create 10 files that each have a matching line
      const filePaths = Array.from({ length: 10 }, (_, i) => `file${i}.ts`);
      vi.mocked(glob).mockResolvedValue(filePaths);

      // Each file has content with a matching line
      vi.mocked(fs.readFile).mockImplementation(async (filePath: unknown) => {
        const p = String(filePath);
        if (p.endsWith('.gitignore')) {
          throw new Error('ENOENT');
        }
        // Return a buffer with a matching line
        return Buffer.from('line1\nTODO fix this\nline3\n');
      });

      const result = await grepTextPlugin.execute(
        { query: 'TODO', maxResults: 3 },
        makeCtx(),
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);

      expect(parsed.hasMore).toBe(true);
      expect(parsed.totalCount).toBe(10);
      expect(parsed.items).toHaveLength(3);
      expect(parsed.summary).toBeDefined();
      expect(parsed.summary).toContain('3');
      expect(parsed.summary).toContain('10');
    });

    it('should NOT include a summary line when all results fit', async () => {
      const filePaths = ['file1.ts', 'file2.ts'];
      vi.mocked(glob).mockResolvedValue(filePaths);

      vi.mocked(fs.readFile).mockImplementation(async (filePath: unknown) => {
        const p = String(filePath);
        if (p.endsWith('.gitignore')) {
          throw new Error('ENOENT');
        }
        return Buffer.from('line1\nTODO fix this\nline3\n');
      });

      const result = await grepTextPlugin.execute(
        { query: 'TODO', maxResults: 50 },
        makeCtx(),
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);

      expect(parsed.hasMore).toBe(false);
      expect(parsed.totalCount).toBe(2);
      expect(parsed.items).toHaveLength(2);
      expect(parsed.summary).toBeUndefined();
    });
  });

  // ========================================================================
  // grep-text: Invalid regex returns InvalidRegexError
  // ========================================================================

  describe('grep-text — invalid regex returns InvalidRegexError', () => {
    it('should throw InvalidRegexError for an invalid regex pattern', async () => {
      // glob returns some files so we get past file discovery
      vi.mocked(glob).mockResolvedValue(['file.ts']);

      await expect(
        grepTextPlugin.execute(
          { query: '[invalid(' },
          makeCtx(),
        ),
      ).rejects.toThrow(InvalidRegexError);
    });

    it('should include the pattern in the InvalidRegexError', async () => {
      vi.mocked(glob).mockResolvedValue(['file.ts']);

      try {
        await grepTextPlugin.execute(
          { query: '(unclosed' },
          makeCtx(),
        );
        expect.fail('Should have thrown InvalidRegexError');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidRegexError);
        const regexErr = err as InvalidRegexError;
        expect(regexErr.pattern).toBe('(unclosed');
        expect(regexErr.message).toContain('(unclosed');
      }
    });
  });

  // ========================================================================
  // search-files: Invalid glob returns InvalidGlobError
  // ========================================================================

  describe('search-files — invalid glob returns InvalidGlobError', () => {
    it('should throw InvalidGlobError when glob library rejects the pattern', async () => {
      // Make glob throw an error to simulate an invalid pattern
      vi.mocked(glob).mockRejectedValue(new Error('Invalid pattern'));

      await expect(
        searchFilesPlugin.execute(
          { pattern: 'some-bad-pattern' },
          makeCtx(),
        ),
      ).rejects.toThrow(InvalidGlobError);
    });

    it('should include the pattern in the InvalidGlobError', async () => {
      vi.mocked(glob).mockRejectedValue(new Error('Unexpected token'));

      try {
        await searchFilesPlugin.execute(
          { pattern: 'bad[glob' },
          makeCtx(),
        );
        expect.fail('Should have thrown InvalidGlobError');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidGlobError);
        const globErr = err as InvalidGlobError;
        expect(globErr.pattern).toBe('bad[glob');
        expect(globErr.message).toContain('bad[glob');
      }
    });
  });
});
