/**
 * Unit tests for Planner Service.
 *
 * Validates: Requirements 17.3, 17.4, 17.5
 *
 * - 17.3: create-only mode prevents overwriting existing planning files
 * - 17.4: All 4 phases emit planner:progress WebSocket events
 * - 17.5: planner:done event includes list of generated file paths
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock node:fs/promises used by scanFileTree and loadReversaContext
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
}));

// Mock OpenClaude client
const mockComplete = vi.fn();
vi.mock('../../openclaude/openclaude.client.js', () => ({
  complete: (...args: unknown[]) => mockComplete(...args),
}));

// Mock Memory Service
const mockMemorySearch = vi.fn();
vi.mock('../../memory/memory.service.js', () => ({
  search: (...args: unknown[]) => mockMemorySearch(...args),
}));

// Mock Obsidian Adapter
const mockWriteNote = vi.fn();
vi.mock('../../memory/obsidian.adapter.js', () => ({
  writeNote: (...args: unknown[]) => mockWriteNote(...args),
}));

// Mock prompt templates
vi.mock('../templates/requirements.prompt.js', () => ({
  buildRequirementsPrompt: vi.fn().mockReturnValue('requirements-prompt'),
}));

vi.mock('../templates/design.prompt.js', () => ({
  buildDesignPrompt: vi.fn().mockReturnValue('design-prompt'),
}));

vi.mock('../templates/tasks.prompt.js', () => ({
  buildTasksPrompt: vi.fn().mockReturnValue('tasks-prompt'),
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

const { generate } = await import('../planner.service.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock emit function that records all calls. */
function createEmit(): vi.Mock & { calls: Array<[string, unknown]> } {
  return vi.fn();
}

/** Default mock for openclaude.complete — returns content based on prompt. */
function setupDefaultComplete(): void {
  mockComplete.mockImplementation(
    async (req: { messages: Array<{ content: string }> }) => {
      const prompt = req.messages[0]?.content ?? '';
      if (prompt.includes('requirements')) {
        return { message: { content: '# Requirements content' } };
      }
      if (prompt.includes('design')) {
        return { message: { content: '# Design content' } };
      }
      return { message: { content: '# Tasks content' } };
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Planner Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemorySearch.mockResolvedValue([]);
    mockWriteNote.mockResolvedValue(undefined);
    setupDefaultComplete();
  });

  // ========================================================================
  // Req 17.3: create-only mode prevents overwriting existing planning files
  // ========================================================================

  describe('create-only mode prevents overwriting (Req 17.3)', () => {
    it('should call obsidian.writeNote with mode "create-only" for all 3 files', async () => {
      const emit = createEmit();

      await generate('Build a todo app', '/workspace', emit);

      // writeNote should be called 3 times (requirements, design, tasks)
      expect(mockWriteNote).toHaveBeenCalledTimes(3);

      // Each call should use "create-only" mode
      expect(mockWriteNote).toHaveBeenNthCalledWith(
        1,
        'requirements.md',
        expect.any(String),
        'create-only',
      );
      expect(mockWriteNote).toHaveBeenNthCalledWith(
        2,
        'design.md',
        expect.any(String),
        'create-only',
      );
      expect(mockWriteNote).toHaveBeenNthCalledWith(
        3,
        'tasks.md',
        expect.any(String),
        'create-only',
      );
    });

    it('should propagate error when writeNote rejects for existing file', async () => {
      const emit = createEmit();

      // Simulate obsidian.writeNote rejecting because file already exists
      mockWriteNote.mockRejectedValueOnce(
        new Error('File "requirements.md" already exists'),
      );

      await expect(
        generate('Build a todo app', '/workspace', emit),
      ).rejects.toThrow(/already exists/i);
    });

    it('should stop generation when a file already exists (no partial writes)', async () => {
      const emit = createEmit();

      // First writeNote (requirements.md) succeeds, second (design.md) fails
      mockWriteNote
        .mockResolvedValueOnce(undefined) // requirements.md OK
        .mockRejectedValueOnce(new Error('File "design.md" already exists'));

      await expect(
        generate('Build a todo app', '/workspace', emit),
      ).rejects.toThrow(/already exists/i);

      // Only 2 writeNote calls should have been made (requirements succeeded, design failed)
      expect(mockWriteNote).toHaveBeenCalledTimes(2);
    });
  });

  // ========================================================================
  // Req 17.4: All 4 phases emit planner:progress events
  // ========================================================================

  describe('progress events for all 4 phases (Req 17.4)', () => {
    it('should emit planner:progress for context, requirements, design, and tasks phases', async () => {
      const emit = createEmit();

      await generate('Build a todo app', '/workspace', emit);

      const progressCalls = emit.mock.calls.filter(
        ([type]: [string]) => type === 'planner:progress',
      );

      // Extract the phases from progress events
      const phases = progressCalls.map(
        ([, data]: [string, { phase: string }]) => data.phase,
      );

      // All 4 phases must be present
      expect(phases).toContain('context');
      expect(phases).toContain('requirements');
      expect(phases).toContain('design');
      expect(phases).toContain('tasks');
    });

    it('should emit progress events in the correct order: context → requirements → design → tasks', async () => {
      const emit = createEmit();

      await generate('Build a todo app', '/workspace', emit);

      const progressCalls = emit.mock.calls.filter(
        ([type]: [string]) => type === 'planner:progress',
      );

      // Get the first occurrence of each phase
      const phaseOrder = ['context', 'requirements', 'design', 'tasks'];
      const firstIndices = phaseOrder.map((phase) =>
        progressCalls.findIndex(
          ([, data]: [string, { phase: string }]) => data.phase === phase,
        ),
      );

      // Each phase should appear and be in ascending order
      for (let i = 0; i < firstIndices.length - 1; i++) {
        expect(firstIndices[i]).toBeGreaterThanOrEqual(0);
        expect(firstIndices[i]!).toBeLessThan(firstIndices[i + 1]!);
      }
    });

    it('should emit at least one progress event per phase', async () => {
      const emit = createEmit();

      await generate('Build a todo app', '/workspace', emit);

      const progressCalls = emit.mock.calls.filter(
        ([type]: [string]) => type === 'planner:progress',
      );

      const phaseCounts = new Map<string, number>();
      for (const [, data] of progressCalls) {
        const phase = (data as { phase: string }).phase;
        phaseCounts.set(phase, (phaseCounts.get(phase) ?? 0) + 1);
      }

      expect(phaseCounts.get('context')).toBeGreaterThanOrEqual(1);
      expect(phaseCounts.get('requirements')).toBeGreaterThanOrEqual(1);
      expect(phaseCounts.get('design')).toBeGreaterThanOrEqual(1);
      expect(phaseCounts.get('tasks')).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // Req 17.5: planner:done event includes file paths
  // ========================================================================

  describe('planner:done event includes file paths (Req 17.5)', () => {
    it('should emit planner:done with all 3 generated file paths', async () => {
      const emit = createEmit();

      await generate('Build a todo app', '/workspace', emit);

      const doneCalls = emit.mock.calls.filter(
        ([type]: [string]) => type === 'planner:done',
      );

      expect(doneCalls).toHaveLength(1);

      const doneData = doneCalls[0]![1] as { files: string[] };
      expect(doneData.files).toEqual(
        expect.arrayContaining([
          'requirements.md',
          'design.md',
          'tasks.md',
        ]),
      );
      expect(doneData.files).toHaveLength(3);
    });

    it('should emit planner:done after all planner:progress events', async () => {
      const emit = createEmit();

      await generate('Build a todo app', '/workspace', emit);

      const allCalls = emit.mock.calls;
      const lastProgressIndex = allCalls.reduce(
        (maxIdx, [type], idx) =>
          type === 'planner:progress' ? idx : maxIdx,
        -1,
      );
      const doneIndex = allCalls.findIndex(
        ([type]: [string]) => type === 'planner:done',
      );

      expect(doneIndex).toBeGreaterThan(lastProgressIndex);
    });

    it('should return the generated file paths from the generate function', async () => {
      const emit = createEmit();

      const result = await generate('Build a todo app', '/workspace', emit);

      expect(result).toEqual(
        expect.arrayContaining([
          'requirements.md',
          'design.md',
          'tasks.md',
        ]),
      );
      expect(result).toHaveLength(3);
    });
  });
});
