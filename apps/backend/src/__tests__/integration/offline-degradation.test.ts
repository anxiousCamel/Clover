/**
 * Integration tests for offline degradation.
 *
 * Validates: Requirements 31.1, 31.2, 31.3
 *
 * Tests that when the system is offline:
 *   1. Connectivity check returns false → search service routes to offline adapter (31.1)
 *   2. All features except online search work normally (31.2)
 *   3. No errors are thrown or displayed to the user (31.3)
 *
 * The connectivity check is mocked to simulate offline state.
 * The search service, adapters, and other modules are wired together with real logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  SearchResult,
  Chunk,
  VectorChunk,
  CompletionChunk,
  CompletionRequest,
  Agent,
} from '@clover/shared';

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE importing modules under test
// ---------------------------------------------------------------------------

// 1. Mock connectivity check to simulate offline state
let mockOnlineState = false;
vi.mock('../../search/connectivity.check.js', () => ({
  isOnline: vi.fn(async () => mockOnlineState),
}));

// 2. Mock the embedder — returns a deterministic fake vector
const mockEmbed = vi.fn<(text: string) => Promise<number[]>>();
vi.mock('../../memory/embedder.js', () => ({
  embed: (...args: unknown[]) => mockEmbed(args[0] as string),
}));

// 3. Mock LanceDB adapter — track inserts and support search
const lanceInserted: VectorChunk[][] = [];
const mockLanceInit = vi.fn<(dbPath: string) => Promise<void>>();
const mockLanceInsert = vi.fn<(chunks: VectorChunk[]) => Promise<void>>();
const mockLanceSimilaritySearch = vi.fn<(vector: number[], topK: number, filter?: string) => Promise<Chunk[]>>();
const mockLanceUpsertByPath = vi.fn<(path: string, chunks: VectorChunk[]) => Promise<void>>();

vi.mock('../../memory/lancedb.adapter.js', () => ({
  init: (...args: unknown[]) => mockLanceInit(args[0] as string),
  insert: (...args: unknown[]) => {
    const chunks = args[0] as VectorChunk[];
    lanceInserted.push(chunks);
    return mockLanceInsert(chunks);
  },
  upsertByPath: (...args: unknown[]) => mockLanceUpsertByPath(args[0] as string, args[1] as VectorChunk[]),
  similaritySearch: (...args: unknown[]) =>
    mockLanceSimilaritySearch(args[0] as number[], args[1] as number, args[2] as string | undefined),
}));

// 4. SQLiteStore now uses sql.js directly — no mock needed

// 5. Mock OpenClaude gRPC client
const mockStreamComplete = vi.fn<(req: CompletionRequest) => AsyncGenerator<CompletionChunk>>();
vi.mock('../../openclaude/openclaude.client.js', () => ({
  streamComplete: (...args: unknown[]) => mockStreamComplete(args[0] as CompletionRequest),
}));

// 6. Mock glob so agent-engine and tool-registry don't scan filesystem
vi.mock('glob', () => ({
  glob: vi.fn().mockResolvedValue([]),
}));

// 7. Mock tool-registry
const mockToolRegistryListTools = vi.fn<() => string[]>();
const mockToolRegistryGetPlugin = vi.fn();
const mockToolRegistryExecute = vi.fn();
const mockToolRegistryLoadPlugins = vi.fn<() => Promise<void>>();

vi.mock('../../tools/tool-registry.js', () => ({
  listTools: () => mockToolRegistryListTools(),
  getPlugin: (...args: unknown[]) => mockToolRegistryGetPlugin(args[0]),
  execute: (...args: unknown[]) => mockToolRegistryExecute(args[0], args[1], args[2]),
  loadPlugins: () => mockToolRegistryLoadPlugins(),
}));

// 8. Mock config
vi.mock('../../config/config.js', () => ({
  config: {
    memory: {
      dbPath: './data/lancedb',
      topK: 5,
      chunkSize: 512,
      chunkOverlap: 50,
    },
    vault: {
      path: '/test-vault',
      watchDebounceMs: 500,
    },
    confirmation: {
      timeoutMs: 60_000,
    },
    session: {
      historyLimit: 20,
    },
  },
}));

// ---------------------------------------------------------------------------
// Import modules under test AFTER mocks are registered
// ---------------------------------------------------------------------------

const { search: searchService } = await import('../../search/search.service.js');
const { isOnline } = await import('../../search/connectivity.check.js');
const { duckduckgoAdapter } = await import('../../search/duckduckgo.adapter.js');
const { offlineAdapter } = await import('../../search/offline.adapter.js');
const memoryService = await import('../../memory/memory.service.js');
const { SQLiteStore } = await import('../../storage/sqlite.store.js');
const sessionManager = await import('../../orchestrator/session.manager.js');
const orchestrator = await import('../../orchestrator/orchestrator.js');
const agentEngine = await import('../../agents/agent-engine.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function* fakeStream(chunks: CompletionChunk[]): AsyncGenerator<CompletionChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function makeCatchAllAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    name: overrides.name ?? 'test-coder',
    systemPrompt: overrides.systemPrompt ?? 'You are a helpful assistant.',
    allowedTools: overrides.allowedTools ?? ['read-file', 'list-files'],
    matchesIntent: overrides.matchesIntent ?? (() => true),
    maxTurns: overrides.maxTurns ?? 10,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Offline Degradation Integration', () => {
  let store: InstanceType<typeof SQLiteStore>;

  beforeEach(async () => {
    vi.clearAllMocks();
    lanceInserted.length = 0;

    // Default: system is offline
    mockOnlineState = false;

    // Set up default mock behaviors
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5]);
    mockLanceInit.mockResolvedValue(undefined);
    mockLanceInsert.mockResolvedValue(undefined);
    mockLanceUpsertByPath.mockResolvedValue(undefined);
    mockLanceSimilaritySearch.mockResolvedValue([]);
    mockToolRegistryListTools.mockReturnValue([]);
    mockToolRegistryGetPlugin.mockReturnValue(undefined);
    mockToolRegistryLoadPlugins.mockResolvedValue(undefined);

    // Set up SQLite store and session manager
    store = new SQLiteStore(':memory:');
    await store.ensureReady();
    sessionManager.init(store);

    // Register a catch-all agent
    agentEngine.registerAgent(makeCatchAllAgent());
  });

  // ========================================================================
  // Req 31.1: Connectivity check returns false → search routes to offline adapter
  // ========================================================================

  describe('search service uses offline adapter when offline (Req 31.1)', () => {
    it('should route search to offline adapter when connectivity check returns false', async () => {
      mockOnlineState = false;

      // Set up offline adapter to return local results via LanceDB mock
      const offlineChunks: Chunk[] = [
        { id: 'local-1', source: 'vault', text: 'Local knowledge about TypeScript patterns' },
      ];
      mockLanceSimilaritySearch.mockResolvedValue(offlineChunks);

      const results = await searchService('TypeScript patterns');

      // Verify connectivity was checked (DuckDuckGo adapter delegates to isOnline)
      expect(isOnline).toHaveBeenCalled();

      // Verify results came from the offline adapter (LanceDB semantic search)
      expect(results.length).toBe(1);
      expect(results[0].source).toBe('offline');
      expect(results[0].snippet).toContain('Local knowledge about TypeScript patterns');
    });

    it('should not throw errors when search falls back to offline adapter', async () => {
      mockOnlineState = false;
      mockLanceSimilaritySearch.mockResolvedValue([]);

      // Search should complete without throwing, even with no results
      await expect(searchService('any query')).resolves.not.toThrow();

      const results = await searchService('any query');
      expect(Array.isArray(results)).toBe(true);
    });

    it('should never call DuckDuckGo search when offline', async () => {
      mockOnlineState = false;
      mockLanceSimilaritySearch.mockResolvedValue([]);

      // Spy on the DuckDuckGo adapter's search method
      const ddgSearchSpy = vi.spyOn(duckduckgoAdapter, 'search');

      await searchService('test query');

      // DuckDuckGo search should not have been called
      expect(ddgSearchSpy).not.toHaveBeenCalled();

      ddgSearchSpy.mockRestore();
    });

    it('should transparently switch to online adapter when connectivity is restored', async () => {
      // Start offline
      mockOnlineState = false;
      mockLanceSimilaritySearch.mockResolvedValue([
        { id: 'local-1', source: 'vault', text: 'Offline result' },
      ]);

      const offlineResults = await searchService('test');
      expect(offlineResults[0].source).toBe('offline');

      // Restore connectivity — DuckDuckGo adapter's search will be called
      // but since we haven't mocked the actual fetch, we spy on isAvailable
      mockOnlineState = true;

      // DuckDuckGo adapter delegates isAvailable to isOnline, which now returns true.
      // Its search() will attempt a real fetch, so we spy on it to verify selection.
      const ddgSearchSpy = vi.spyOn(duckduckgoAdapter, 'search')
        .mockResolvedValue([
          { title: 'Online Result', url: 'https://example.com', snippet: 'Web result', source: 'duckduckgo' },
        ]);

      const onlineResults = await searchService('test');
      expect(onlineResults[0].source).toBe('duckduckgo');
      expect(ddgSearchSpy).toHaveBeenCalled();

      ddgSearchSpy.mockRestore();
    });
  });

  // ========================================================================
  // Req 31.2: All features except online search work normally when offline
  // ========================================================================

  describe('all features except online search work normally when offline (Req 31.2)', () => {
    it('should handle chat messages through the full pipeline when offline', async () => {
      mockOnlineState = false;

      const session = sessionManager.createSession('/workspace/offline-project');

      mockStreamComplete.mockImplementation(() =>
        fakeStream([
          { type: 'token', token: 'Offline ' },
          { type: 'token', token: 'response' },
          { type: 'usage', usage: { inputTokens: 15, outputTokens: 8 } },
        ]),
      );

      const emit = vi.fn();

      const result = await orchestrator.handle(session.id, 'Hello while offline', {
        workspacePath: '/workspace/offline-project',
        emit,
      });

      // Chat should work normally
      expect(result.agent).toBe('test-coder');
      expect(result.text).toBe('Offline response');
      expect(result.cancelled).toBe(false);

      // Token streaming should work
      const tokenEvents = emit.mock.calls.filter(([type]: [string]) => type === 'message:token');
      expect(tokenEvents.length).toBe(2);

      // Message done event should be emitted
      const doneEvents = emit.mock.calls.filter(([type]: [string]) => type === 'message:done');
      expect(doneEvents.length).toBe(1);
    });

    it('should persist session history to SQLite when offline', async () => {
      mockOnlineState = false;

      const session = sessionManager.createSession('/workspace/offline-project');

      mockStreamComplete.mockImplementation(() =>
        fakeStream([
          { type: 'token', token: 'Saved offline' },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
        ]),
      );

      const emit = vi.fn();
      await orchestrator.handle(session.id, 'Persist this offline', {
        workspacePath: '/workspace/offline-project',
        emit,
      });

      // Verify messages were persisted
      const history = sessionManager.loadHistory(session.id);
      expect(history.length).toBe(2);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Persist this offline');
      expect(history[1].role).toBe('assistant');
      expect(history[1].content).toBe('Saved offline');
    });

    it('should index conversation turns to LanceDB memory when offline', async () => {
      mockOnlineState = false;

      const session = sessionManager.createSession('/workspace/offline-project');

      mockStreamComplete.mockImplementation(() =>
        fakeStream([
          { type: 'token', token: 'Indexed offline' },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
        ]),
      );

      const emit = vi.fn();
      await orchestrator.handle(session.id, 'Index this offline turn', {
        workspacePath: '/workspace/offline-project',
        emit,
      });

      // Verify embedder was called and chunks were inserted into LanceDB
      expect(mockEmbed).toHaveBeenCalled();
      expect(mockLanceInsert).toHaveBeenCalled();
      expect(lanceInserted.length).toBeGreaterThan(0);

      const allChunkTexts = lanceInserted.flat().map(c => c.text);
      const combinedText = allChunkTexts.join(' ');
      expect(combinedText).toContain('Index this offline turn');
      expect(combinedText).toContain('Indexed offline');
    });

    it('should perform RAG memory search when offline', async () => {
      mockOnlineState = false;

      // Set up memory to return relevant chunks
      const memoryChunks: Chunk[] = [
        { id: 'mem-1', source: 'vault', text: 'Relevant offline context' },
      ];
      mockLanceSimilaritySearch.mockResolvedValue(memoryChunks);

      const results = await memoryService.search('offline context query');

      expect(results.length).toBe(1);
      expect(results[0].text).toBe('Relevant offline context');
      expect(mockEmbed).toHaveBeenCalledWith('offline context query');
      expect(mockLanceSimilaritySearch).toHaveBeenCalled();
    });

    it('should route agent dispatch correctly when offline', async () => {
      mockOnlineState = false;

      const session = sessionManager.createSession('/workspace/offline-project');

      let capturedRequest: CompletionRequest | undefined;
      mockStreamComplete.mockImplementation((req: CompletionRequest) => {
        capturedRequest = req;
        return fakeStream([
          { type: 'token', token: 'Agent response' },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
        ]);
      });

      const emit = vi.fn();
      await orchestrator.handle(session.id, 'Write some code', {
        workspacePath: '/workspace/offline-project',
        emit,
      });

      // Agent engine should have dispatched to the catch-all agent
      expect(capturedRequest).toBeDefined();

      // Agent status events should be emitted
      const statusEvents = emit.mock.calls.filter(([type]: [string]) => type === 'agent:status');
      expect(statusEvents.length).toBeGreaterThanOrEqual(2);
      expect(statusEvents[0][1]).toMatchObject({ status: 'running' });
      expect(statusEvents[statusEvents.length - 1][1]).toMatchObject({ status: 'done' });
    });
  });

  // ========================================================================
  // Req 31.3: No errors displayed for features that don't require internet
  // ========================================================================

  describe('no errors displayed for offline-compatible features (Req 31.3)', () => {
    it('should complete full chat flow without any error events when offline', async () => {
      mockOnlineState = false;

      const session = sessionManager.createSession('/workspace/offline-project');

      mockStreamComplete.mockImplementation(() =>
        fakeStream([
          { type: 'token', token: 'No errors here' },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
        ]),
      );

      const emit = vi.fn();
      await orchestrator.handle(session.id, 'Error-free offline test', {
        workspacePath: '/workspace/offline-project',
        emit,
      });

      // No error events should have been emitted
      const errorEvents = emit.mock.calls.filter(
        ([type]: [string]) => type === 'message:error' || type === 'agent:error',
      );
      expect(errorEvents.length).toBe(0);

      // Agent status should end with "done", not "error"
      const statusEvents = emit.mock.calls.filter(([type]: [string]) => type === 'agent:status');
      const lastStatus = statusEvents[statusEvents.length - 1];
      expect(lastStatus[1].status).toBe('done');
    });

    it('should return empty results from offline search without throwing errors', async () => {
      mockOnlineState = false;
      mockLanceSimilaritySearch.mockResolvedValue([]);

      // Search should return empty array, not throw
      const results = await searchService('query with no local matches');
      expect(results).toEqual([]);
    });

    it('should handle multiple sequential operations without errors when offline', async () => {
      mockOnlineState = false;

      const session = sessionManager.createSession('/workspace/offline-project');

      // Perform multiple operations in sequence — none should throw
      mockStreamComplete.mockImplementation(() =>
        fakeStream([
          { type: 'token', token: 'Response' },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
        ]),
      );

      const emit = vi.fn();

      // Operation 1: Chat
      await expect(
        orchestrator.handle(session.id, 'First message', {
          workspacePath: '/workspace/offline-project',
          emit,
        }),
      ).resolves.not.toThrow();

      // Operation 2: Memory search
      await expect(memoryService.search('search query')).resolves.not.toThrow();

      // Operation 3: Another chat
      await expect(
        orchestrator.handle(session.id, 'Second message', {
          workspacePath: '/workspace/offline-project',
          emit,
        }),
      ).resolves.not.toThrow();

      // Operation 4: Search service (falls back to offline)
      await expect(searchService('web search while offline')).resolves.not.toThrow();

      // Verify no error events across all operations
      const errorEvents = emit.mock.calls.filter(
        ([type]: [string]) => type === 'message:error' || type === 'agent:error',
      );
      expect(errorEvents.length).toBe(0);
    });
  });
});
