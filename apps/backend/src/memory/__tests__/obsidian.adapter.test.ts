/**
 * Unit tests for Obsidian Adapter write safety.
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.5
 *
 * Tests that writeNote enforces safety rules per mode:
 * - create-only: fails if file already exists
 * - overwrite: creates .bak backup before writing
 * - append: appends content with \n---\n separator
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: vi.fn(),
  copyFile: vi.fn(),
}));

// Mock config — vault path used by resolveVaultPath
vi.mock('../../config/config.js', () => ({
  config: {
    vault: {
      path: '/mock/vault',
    },
  },
}));

import { readFile, writeFile, access, copyFile } from 'node:fs/promises';

const mockedAccess = vi.mocked(access);
const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedCopyFile = vi.mocked(copyFile);

const { writeNote } = await import('../obsidian.adapter.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate that a file exists (access resolves). */
function fileExists(): void {
  mockedAccess.mockResolvedValue(undefined);
}

/** Simulate that a file does NOT exist (access rejects). */
function fileDoesNotExist(): void {
  mockedAccess.mockRejectedValue(new Error('ENOENT'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Obsidian Adapter — writeNote safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── create-only mode ─────────────────────────────────────────────

  describe('create-only mode', () => {
    it('should create the file when it does not exist', async () => {
      fileDoesNotExist();
      mockedWriteFile.mockResolvedValue(undefined);

      await writeNote('notes/new.md', '# New Note', 'create-only');

      expect(mockedWriteFile).toHaveBeenCalledTimes(1);
      expect(mockedWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('new.md'),
        '# New Note',
        'utf-8',
      );
    });

    it('should throw an error when the file already exists (Req 12.1, 12.2)', async () => {
      fileExists();

      await expect(
        writeNote('notes/existing.md', '# Overwrite attempt', 'create-only'),
      ).rejects.toThrow(/already exists/i);

      // Must NOT write anything
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });
  });

  // ── overwrite mode ───────────────────────────────────────────────

  describe('overwrite mode', () => {
    it('should create a .bak backup before writing when file exists (Req 12.5)', async () => {
      fileExists();
      mockedCopyFile.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue(undefined);
      const confirmFn = vi.fn().mockResolvedValue(true);

      await writeNote('notes/target.md', '# Updated', 'overwrite', confirmFn);

      // Backup must be created
      expect(mockedCopyFile).toHaveBeenCalledTimes(1);
      expect(mockedCopyFile).toHaveBeenCalledWith(
        expect.stringContaining('target.md'),
        expect.stringContaining('target.md.bak'),
      );

      // Then the new content is written
      expect(mockedWriteFile).toHaveBeenCalledTimes(1);
      expect(mockedWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('target.md'),
        '# Updated',
        'utf-8',
      );
    });

    it('should call confirmFn and proceed only when approved', async () => {
      fileExists();
      mockedCopyFile.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue(undefined);
      const confirmFn = vi.fn().mockResolvedValue(true);

      await writeNote('notes/target.md', '# New content', 'overwrite', confirmFn);

      expect(confirmFn).toHaveBeenCalledTimes(1);
      expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    });

    it('should throw when user denies the overwrite', async () => {
      fileExists();
      const confirmFn = vi.fn().mockResolvedValue(false);

      await expect(
        writeNote('notes/target.md', '# Denied', 'overwrite', confirmFn),
      ).rejects.toThrow(/denied/i);

      // No backup, no write
      expect(mockedCopyFile).not.toHaveBeenCalled();
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });

    it('should throw when no confirmFn is provided', async () => {
      await expect(
        writeNote('notes/target.md', '# No confirm', 'overwrite'),
      ).rejects.toThrow(/confirmation function/i);
    });

    it('should skip backup when file does not exist yet', async () => {
      fileDoesNotExist();
      mockedWriteFile.mockResolvedValue(undefined);
      const confirmFn = vi.fn().mockResolvedValue(true);

      await writeNote('notes/brand-new.md', '# Fresh', 'overwrite', confirmFn);

      // No backup needed for a non-existent file
      expect(mockedCopyFile).not.toHaveBeenCalled();
      // But the write still happens
      expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    });
  });

  // ── append mode ──────────────────────────────────────────────────

  describe('append mode', () => {
    it('should append content with \\n---\\n separator (Req 12.3)', async () => {
      const existingContent = '# Existing Note\n\nSome content.';
      mockedReadFile.mockResolvedValue(existingContent as never);
      mockedWriteFile.mockResolvedValue(undefined);

      await writeNote('notes/append-target.md', 'Appended text', 'append');

      expect(mockedReadFile).toHaveBeenCalledTimes(1);
      expect(mockedWriteFile).toHaveBeenCalledTimes(1);

      const writtenContent = mockedWriteFile.mock.calls[0][1];
      expect(writtenContent).toBe(
        '# Existing Note\n\nSome content.\n---\nAppended text',
      );
    });

    it('should not require confirmation for append mode', async () => {
      mockedReadFile.mockResolvedValue('old' as never);
      mockedWriteFile.mockResolvedValue(undefined);

      // No confirmFn passed — should succeed without one
      await writeNote('notes/log.md', 'new entry', 'append');

      expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    });
  });
});
