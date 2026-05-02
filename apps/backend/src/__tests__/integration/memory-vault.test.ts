/**
 * Integration tests for the memory system and vault watcher.
 *
 * Validates: Requirements 11.1, 11.3, 13.1, 13.2, 13.3
 *
 * Tests the full pipeline:
 *   1. Vault Watcher detects file changes → triggers re-indexing → search returns updated content
 *   2. Reversa-ingest indexes .agents/skills/ and CLAUDE.md → search returns chunks with source="reversa"
 *
 * External services (Ollama/embedder, LanceDB) are mocked.
 * Internal modules (Memory Service, Chunker, Vault Watcher, Obsidian Adapter) are wired together.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Chunk, VectorChunk, ToolContext } from '@clover/shared';

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE importing modules under test
// ---------------------------------------------------------------------------

// 1. Mock the embedder — returns a deterministic fake vector
const mockEmbed = vi.fn<(text: string) => Promise<number[]>>();
vi.mock('../../memory/embedder.js', () => ({
  embed: (...args: unknown[]) => mockEmbed(args[0] as string),
}));

// 2. Mock LanceDB adapter — track inserts/upserts and support search
const lanceInserted: VectorChunk[][] = [];
const lanceUpserted: Array<{ path: string; chunks: VectorChunk[] }> = [];
let lanceStore: VectorChunk[] = [];

const mockLanceInit = vi.fn<(dbPath: string) => Promise<void>>();
const mockLanceInsert = vi.fn<(chunks: VectorChunk[]) => Promise<void>>();
const mockLanceUpsertByPath = vi.fn<(path: string, chunks: VectorChunk[]) => Promise<void>>();
const mockLanceSimilaritySearch = vi.fn<(vector: number[], topK: number, filter?: string) => Promise<Chunk[]>>();

vi.mock('../../memory/lancedb.adapter.js', () => ({
  init: (...args: unknown[]) => mockLanceInit(args[0] as string),
  insert: (...args: unknown[]) => {
    const chunks = args[0] as VectorChunk[];
    lanceInserted.push(chunks);
    lanceStore.push(...chunks);
    return mockLanceInsert(chunks);
  },
  upsertByPath: (...args: unknown[]) => {
    const path = args[0] as string;
    const chunks = args[1] as VectorChunk[];
    lanceUpserted.push({ path, chunks });
    // Remove old chunks for this path, then add new ones (upsert behavior)
    lanceStore = lanceStore.filter((c) => c.filePath !== path);
    lanceStore.push(...chunks);
    return mockLanceUpsertByPath(path, chunks);
  },
  similaritySearch: (...args: unknown[]) => {
    const filter = args[2] as string | undefined;
    return mockLanceSimilaritySearch(args[0] as number[], args[1] as number, filter);
  },
}));

// 3. Mock node:fs watch — we'll capture the callback and invoke it manually
let watchCallback: ((event: string, filename: string | null) => void) | null = null;
const mockWatchClose = vi.fn();

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    watch: vi.fn((_path: string, _opts: unknown, cb: (event: string, filename: string | null) => void) => {
      watchCallback = cb;
      return {
        on: vi.fn(),
        close: mockWatchClose,
      };
    }),
  };
});

// 4. Mock node:fs/promises for obsidian adapter reads and reversa-ingest file reads
const mockFsReadFile = vi.fn<(path: string, encoding: string) => Promise<string>>();
const mockFsAccess = vi.fn<(path: string) => Promise<void>>();
const mockFsWriteFile = vi.fn<(path: string, content: string, encoding: string) => Promise<void>>();
const mockFsCopyFile = vi.fn<(src: string, dest: string) => Promise<void>>();
const mockFsReaddir = vi.fn();

vi.mock('node:fs/promises', () => {
  const namedExports = {
    readFile: (...args: unknown[]) => mockFsReadFile(args[0] as string, args[1] as string),
    access: (...args: unknown[]) => mockFsAccess(args[0] as string),
    writeFile: (...args: unknown[]) => mockFsWriteFile(args[0] as string, args[1] as string, args[2] as string),
    copyFile: (...args: unknown[]) => mockFsCopyFile(args[0] as string, args[1] as string),
    readdir: (...args: unknown[]) => mockFsReaddir(args[0] as string, args[1]),
  };
  return {
    ...namedExports,
    default: namedExports,
  };
});

// 5. Mock config — provide vault path and memory settings
vi.mock('../../config/config.js', () => ({
  config: {
    vault: {
      path: '/test-vault',
      watchDebounceMs: 50, // short debounce for fast tests
    },
    memory: {
      dbPath: './data/lancedb',
      topK: 5,
      chunkSize: 512,
      chunkOverlap: 50,
    },
    confirmation: {
      timeoutMs: 60_000,
    },
  },
}));

// 6. Mock glob (not needed for these tests but may be imported transitively)
vi.mock('glob', () => ({
  glob: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Import modules under test AFTER mocks are registered
// ---------------------------------------------------------------------------

const memoryService = await import('../../memory/memory.service.js');
const vaultWatcher = await import('../../memory/vault.watcher.js');
const reversaPlugin = (await import('../../tools/plugins/reversa-ingest.tool.js')).default;
const { join: pathJoin } = await import('node:path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for a given number of milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Simulate a vault file change event via the captured fs.watch callback. */
function simulateFileChange(filename: string): void {
  if (!watchCallback) throw new Error('Vault watcher not started — no watch callback captured');
  watchCallback('change', filename);
}

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

describe('Memory & Vault Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    lanceInserted.length = 0;
    lanceUpserted.length = 0;
    lanceStore = [];
    watchCallback = null;

    // Default mock behaviors
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockLanceInit.mockResolvedValue(undefined);
    mockLanceInsert.mockResolvedValue(undefined);
    mockLanceUpsertByPath.mockResolvedValue(undefined);
    mockLanceSimilaritySearch.mockResolvedValue([]);
  });

  afterEach(() => {
    vaultWatcher.stop();
    vi.useRealTimers();
  });

  // ========================================================================
  // Req 11.1, 11.3: Vault watcher detects file change → re-index → search
  // ========================================================================

  describe('Vault Watcher → re-index → search returns updated content', () => {
    it('should detect a vault file change, trigger re-indexing via upsert, and return updated content on search (Req 11.1, 11.3)', async () => {
      // Arrange: set up the vault file content
      const originalContent = 'Original note about TypeScript patterns.';
      const updatedContent = 'Updated note about advanced TypeScript generics and utility types.';

      // The obsidian adapter resolves paths against the vault root
      // When indexFile is called, it reads via obsidian.read → fs.readFile
      mockFsReadFile.mockResolvedValue(updatedContent);

      // Start the vault watcher with an emit callback
      const emitEvent = vi.fn();
      vaultWatcher.start(emitEvent);

      // Act: simulate a file change event
      simulateFileChange('notes/typescript.md');

      // Advance timers past the debounce window (50ms configured)
      await vi.advanceTimersByTimeAsync(100);

      // Allow the async indexFile promise chain to resolve
      await vi.advanceTimersByTimeAsync(100);

      // Assert: upsertByPath was called for the changed file
      expect(mockLanceUpsertByPath).toHaveBeenCalled();
      const upsertCall = lanceUpserted[0];
      expect(upsertCall).toBeDefined();
      expect(upsertCall.path).toContain('typescript.md');
      expect(upsertCall.chunks.length).toBeGreaterThan(0);

      // Verify the chunks contain the updated content
      const chunkTexts = upsertCall.chunks.map((c) => c.text);
      expect(chunkTexts.some((t) => t.includes('advanced TypeScript generics'))).toBe(true);

      // Assert: memory:indexed event was emitted
      expect(emitEvent).toHaveBeenCalledWith('memory:indexed', expect.objectContaining({
        source: 'vault',
      }));

      // Now simulate a search that returns the updated content
      mockLanceSimilaritySearch.mockResolvedValue([
        {
          id: 'chunk-1',
          source: upsertCall.chunks[0].filePath ?? 'vault',
          text: updatedContent,
          score: 0.95,
        },
      ]);

      const results = await memoryService.search('TypeScript generics');
      expect(results.length).toBe(1);
      expect(results[0].text).toContain('advanced TypeScript generics');
    });

    it('should debounce rapid file changes and only re-index once (Req 11.1)', async () => {
      mockFsReadFile.mockResolvedValue('Final content after rapid edits.');

      const emitEvent = vi.fn();
      vaultWatcher.start(emitEvent);

      // Simulate rapid changes to the same file
      simulateFileChange('notes/rapid.md');
      await vi.advanceTimersByTimeAsync(20);
      simulateFileChange('notes/rapid.md');
      await vi.advanceTimersByTimeAsync(20);
      simulateFileChange('notes/rapid.md');

      // Advance past debounce window
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      // Should only have been called once (debounced)
      expect(mockLanceUpsertByPath).toHaveBeenCalledTimes(1);
    });

    it('should re-index within 2 seconds of a file change (Req 11.1)', async () => {
      mockFsReadFile.mockResolvedValue('Content for timing test.');

      const emitEvent = vi.fn();
      vaultWatcher.start(emitEvent);

      simulateFileChange('notes/timing.md');

      // Advance 2 seconds — re-indexing should have completed
      await vi.advanceTimersByTimeAsync(2000);

      expect(mockLanceUpsertByPath).toHaveBeenCalled();
      expect(emitEvent).toHaveBeenCalledWith('memory:indexed', expect.objectContaining({
        source: 'vault',
      }));
    });

    it('should ignore non-markdown file changes', async () => {
      const emitEvent = vi.fn();
      vaultWatcher.start(emitEvent);

      // Simulate changes to non-markdown files
      simulateFileChange('image.png');
      simulateFileChange('data.json');
      simulateFileChange('script.js');

      await vi.advanceTimersByTimeAsync(200);

      expect(mockLanceUpsertByPath).not.toHaveBeenCalled();
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it('should use upsert to remove old chunks before inserting new ones (Req 11.3)', async () => {
      mockFsReadFile.mockResolvedValue('Version 2 of the document.');

      const emitEvent = vi.fn();
      vaultWatcher.start(emitEvent);

      simulateFileChange('notes/versioned.md');
      await vi.advanceTimersByTimeAsync(200);

      // Verify upsertByPath was called (not plain insert)
      expect(mockLanceUpsertByPath).toHaveBeenCalled();
      expect(mockLanceInsert).not.toHaveBeenCalled();

      // The upsert call should have the file path as first arg
      const call = mockLanceUpsertByPath.mock.calls[0];
      expect(call[0]).toContain('versioned.md');
    });
  });

  // ========================================================================
  // Req 13.1, 13.2, 13.3: Reversa-ingest indexes skills and CLAUDE.md
  // ========================================================================

  describe('Reversa-ingest indexes .agents/skills/ and CLAUDE.md', () => {
    const WORKSPACE = '/test-workspace';

    // Build expected paths using pathJoin so they match on any OS
    const skillsDir = pathJoin(WORKSPACE, '.agents', 'skills');
    const claudeMdPath = pathJoin(WORKSPACE, 'CLAUDE.md');

    it('should index .agents/skills/ files and CLAUDE.md with source="reversa" (Req 13.1, 13.2, 13.3)', async () => {
      vi.useRealTimers();
      process.env['CLOVER_WORKSPACE'] = WORKSPACE;

      // Mock fs.access to indicate both paths exist
      mockFsAccess.mockImplementation(async (p: string) => {
        if (p === skillsDir || p === claudeMdPath) return;
        throw new Error('ENOENT');
      });

      // Mock readdir to return skill files
      mockFsReaddir.mockResolvedValue([
        { isFile: () => true, name: 'coding-standards.md' },
        { isFile: () => true, name: 'testing-guide.md' },
        { isFile: () => false, name: 'subdir' }, // directory, should be skipped
      ]);

      // Mock readFile to return content for each file
      mockFsReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('coding-standards.md')) {
          return 'Always use TypeScript strict mode. Prefer const over let.';
        }
        if (filePath.includes('testing-guide.md')) {
          return 'Write unit tests for all public functions. Use vitest.';
        }
        if (filePath.includes('CLAUDE.md')) {
          return 'This project uses pnpm workspaces. Run tests with pnpm test.';
        }
        throw new Error(`Unexpected file read: ${filePath}`);
      });

      const ctx = makeCtx({ workspacePath: WORKSPACE });

      // Act: execute the reversa-ingest plugin
      const result = await reversaPlugin.execute({}, ctx);

      // Assert: plugin reports success
      expect(result.success).toBe(true);
      expect(result.output).toContain('2 skill file(s)');
      expect(result.output).toContain('CLAUDE.md');

      // Assert: indexText was called for each file (3 total: 2 skills + 1 CLAUDE.md)
      // Each call goes through chunker → embedder → lancedb.insert
      expect(mockEmbed).toHaveBeenCalled();
      expect(lanceInserted.length).toBe(3);

      // Assert: all chunks have source="reversa"
      const allChunks = lanceInserted.flat();
      for (const chunk of allChunks) {
        expect(chunk.source).toBe('reversa');
      }

      // Assert: chunk texts contain the expected content
      const allTexts = allChunks.map((c) => c.text);
      const combinedText = allTexts.join(' ');
      expect(combinedText).toContain('TypeScript strict mode');
      expect(combinedText).toContain('unit tests');
      expect(combinedText).toContain('pnpm workspaces');

      // Now verify search returns reversa-sourced chunks
      mockLanceSimilaritySearch.mockResolvedValue(
        allChunks.map((c) => ({
          id: c.id,
          source: c.source,
          text: c.text,
          score: 0.9,
        })),
      );

      const searchResults = await memoryService.search('TypeScript testing');
      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults.every((r) => r.source === 'reversa')).toBe(true);

      delete process.env['CLOVER_WORKSPACE'];
    });

    it('should handle missing CLAUDE.md gracefully (Req 13.2)', async () => {
      vi.useRealTimers();
      process.env['CLOVER_WORKSPACE'] = WORKSPACE;

      // Mock: skills dir exists, CLAUDE.md does NOT exist
      mockFsAccess.mockImplementation(async (p: string) => {
        if (p === skillsDir) return;
        throw new Error('ENOENT');
      });

      mockFsReaddir.mockResolvedValue([
        { isFile: () => true, name: 'skill-one.md' },
      ]);

      mockFsReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('skill-one.md')) {
          return 'Skill one content about code review.';
        }
        throw new Error(`Unexpected file read: ${filePath}`);
      });

      const ctx = makeCtx({ workspacePath: WORKSPACE });

      // Act
      const result = await reversaPlugin.execute({}, ctx);

      // Assert: success with only skill files
      expect(result.success).toBe(true);
      expect(result.output).toContain('1 skill file(s)');
      expect(result.output).toContain('CLAUDE.md not found');

      // Only 1 file indexed (the skill file)
      expect(lanceInserted.length).toBe(1);
      const allChunks = lanceInserted.flat();
      expect(allChunks.every((c) => c.source === 'reversa')).toBe(true);

      delete process.env['CLOVER_WORKSPACE'];
    });

    it('should handle missing .agents/skills/ directory gracefully (Req 13.1)', async () => {
      vi.useRealTimers();
      process.env['CLOVER_WORKSPACE'] = WORKSPACE;

      // Mock: skills dir does NOT exist, CLAUDE.md exists
      mockFsAccess.mockImplementation(async (p: string) => {
        if (p === claudeMdPath) return;
        throw new Error('ENOENT');
      });

      mockFsReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('CLAUDE.md')) {
          return 'Project uses monorepo with pnpm.';
        }
        throw new Error(`Unexpected file read: ${filePath}`);
      });

      const ctx = makeCtx({ workspacePath: WORKSPACE });

      // Act
      const result = await reversaPlugin.execute({}, ctx);

      // Assert: success with only CLAUDE.md
      expect(result.success).toBe(true);
      expect(result.output).toContain('0 skill file(s)');
      expect(result.output).toContain('Indexed CLAUDE.md');

      // Only 1 file indexed (CLAUDE.md)
      expect(lanceInserted.length).toBe(1);
      const allChunks = lanceInserted.flat();
      expect(allChunks.every((c) => c.source === 'reversa')).toBe(true);

      delete process.env['CLOVER_WORKSPACE'];
    });
  });
});
