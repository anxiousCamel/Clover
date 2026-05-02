/**
 * Integration tests for the chat flow.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 9.3, 10.3
 *
 * Tests the full pipeline:
 *   send message → orchestrator builds context → agent dispatched →
 *   tokens streamed via WebSocket → turn saved to SQLite → turn indexed to LanceDB
 *
 * External services (OpenClaude gRPC, Ollama/embedder, LanceDB) are mocked.
 * Internal modules (Orchestrator, Session Manager, Memory Service, Agent Engine)
 * are wired together with real logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  Agent,
  CompletionChunk,
  CompletionRequest,
  Chunk,
  VectorChunk,
} from '@clover/shared';

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE importing modules under test
// ---------------------------------------------------------------------------

// 1. Import SQLiteStore directly (uses sql.js internally, no native deps)
// No mocking needed for better-sqlite3

// 2. Mock OpenClaude gRPC client — streamComplete returns an async generator
const mockStreamComplete = vi.fn<(req: CompletionRequest) => AsyncGenerator<CompletionChunk>>();
vi.mock('../../openclaude/openclaude.client.js', () => ({
  streamComplete: (...args: unknown[]) => mockStreamComplete(args[0] as CompletionRequest),
}));

// 3. Mock the embedder — returns a deterministic fake vector
const mockEmbed = vi.fn<(text: string) => Promise<number[]>>();
vi.mock('../../memory/embedder.js', () => ({
  embed: (...args: unknown[]) => mockEmbed(args[0] as string),
}));

// 4. Mock LanceDB adapter — track inserts and return empty search results
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

// 5. Mock glob so agent-engine.loadAgents and tool-registry.loadPlugins don't scan filesystem
const mockGlob = vi.fn<(pattern: string, opts?: unknown) => Promise<string[]>>();
vi.mock('glob', () => ({
  glob: (...args: unknown[]) => mockGlob(args[0] as string, args[1]),
}));

// 6. Mock tool-registry — we don't need real tool plugins for this test
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

// ---------------------------------------------------------------------------
// Import modules under test AFTER mocks are registered
// ---------------------------------------------------------------------------

const { SQLiteStore } = await import('../../storage/sqlite.store.js');
const sessionManager = await import('../../orchestrator/session.manager.js');
const orchestrator = await import('../../orchestrator/orchestrator.js');
const agentEngine = await import('../../agents/agent-engine.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake async generator that yields the given chunks. */
async function* fakeStream(chunks: CompletionChunk[]): AsyncGenerator<CompletionChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/** Create a test agent that matches all intents. */
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

describe('Chat Flow Integration', () => {
  let store: InstanceType<typeof SQLiteStore>;

  beforeEach(async () => {
    vi.clearAllMocks();
    lanceInserted.length = 0;

    // Set up SQLite store (in-memory) and wire to session manager
    store = new SQLiteStore(':memory:');
    await store.ensureReady();
    sessionManager.init(store);

    // Set up default mock behaviors
    mockGlob.mockResolvedValue([]);
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5]);
    mockLanceInit.mockResolvedValue(undefined);
    mockLanceInsert.mockResolvedValue(undefined);
    mockLanceSimilaritySearch.mockResolvedValue([]);
    mockLanceUpsertByPath.mockResolvedValue(undefined);
    mockToolRegistryListTools.mockReturnValue([]);
    mockToolRegistryGetPlugin.mockReturnValue(undefined);
    mockToolRegistryLoadPlugins.mockResolvedValue(undefined);

    // Register a catch-all agent so dispatch always succeeds
    agentEngine.registerAgent(makeCatchAllAgent());
  });

  afterEach(() => {
    store.close();
  });

  // ========================================================================
  // Req 1.1: User sends a message, orchestrator handles it
  // ========================================================================

  it('should handle a user message through the full orchestrator pipeline', async () => {
    // Arrange: create a session
    const session = sessionManager.createSession('/workspace/my-project');

    // Mock OpenClaude to stream back tokens
    mockStreamComplete.mockImplementation(() =>
      fakeStream([
        { type: 'token', token: 'Hello' },
        { type: 'token', token: ' world' },
        { type: 'usage', usage: { inputTokens: 15, outputTokens: 8 } },
      ]),
    );

    const emit = vi.fn();

    // Act: send a message through the orchestrator
    const result = await orchestrator.handle(session.id, 'Hi there!', {
      workspacePath: '/workspace/my-project',
      emit,
    });

    // Assert: orchestrator returns the agent name and accumulated text
    expect(result.agent).toBe('test-coder');
    expect(result.text).toBe('Hello world');
    expect(result.cancelled).toBe(false);
  });

  // ========================================================================
  // Req 1.2: Orchestrator builds context with system prompt, memory, history
  // ========================================================================

  it('should build CompletionRequest with system prompt, memory chunks, history, and user message', async () => {
    const session = sessionManager.createSession('/workspace/project');

    // Pre-populate history
    sessionManager.saveMessage(session.id, { role: 'user', content: 'Previous question' });
    sessionManager.saveMessage(session.id, { role: 'assistant', content: 'Previous answer' });

    // Mock memory search to return relevant chunks
    const memoryChunks: Chunk[] = [
      { id: 'chunk-1', source: 'vault', text: 'Relevant context from vault' },
    ];
    mockLanceSimilaritySearch.mockResolvedValue(memoryChunks);

    // Capture the CompletionRequest sent to streamComplete
    let capturedRequest: CompletionRequest | undefined;
    mockStreamComplete.mockImplementation((req: CompletionRequest) => {
      capturedRequest = req;
      return fakeStream([
        { type: 'token', token: 'Response' },
        { type: 'usage', usage: { inputTokens: 20, outputTokens: 5 } },
      ]);
    });

    const emit = vi.fn();
    await orchestrator.handle(session.id, 'New question', {
      workspacePath: '/workspace/project',
      emit,
    });

    // Verify the request was captured
    expect(capturedRequest).toBeDefined();
    const messages = capturedRequest!.messages;

    // The agent engine injects its own system prompt, replacing the orchestrator's.
    // But the orchestrator's context window should have been built correctly.
    // The first message should be a system prompt (injected by agent engine)
    expect(messages[0].role).toBe('system');

    // Memory search should have been called with the user message
    expect(mockLanceSimilaritySearch).toHaveBeenCalled();
    expect(mockEmbed).toHaveBeenCalledWith('New question');

    // The user message should be the last message in the request
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toBe('New question');

    // History messages should be present in the request
    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    // At least the previous history + new user message
    expect(userMessages.length).toBeGreaterThanOrEqual(2);
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);
  });

  // ========================================================================
  // Req 1.3: Tokens streamed via WebSocket events
  // ========================================================================

  it('should emit message:token WebSocket events for each streamed token', async () => {
    const session = sessionManager.createSession('/workspace/project');

    mockStreamComplete.mockImplementation(() =>
      fakeStream([
        { type: 'token', token: 'First' },
        { type: 'token', token: ' token' },
        { type: 'token', token: ' stream' },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } },
      ]),
    );

    const emit = vi.fn();
    await orchestrator.handle(session.id, 'Stream test', {
      workspacePath: '/workspace/project',
      emit,
    });

    // Extract message:token events
    const tokenEvents = emit.mock.calls.filter(
      ([type]: [string]) => type === 'message:token',
    );

    expect(tokenEvents.length).toBe(3);
    expect(tokenEvents[0][1]).toMatchObject({ sessionId: session.id, token: 'First' });
    expect(tokenEvents[1][1]).toMatchObject({ sessionId: session.id, token: ' token' });
    expect(tokenEvents[2][1]).toMatchObject({ sessionId: session.id, token: ' stream' });
  });

  // ========================================================================
  // Req 1.4: message:done event emitted when stream completes
  // ========================================================================

  it('should emit message:done WebSocket event with usage stats when stream completes', async () => {
    const session = sessionManager.createSession('/workspace/project');

    mockStreamComplete.mockImplementation(() =>
      fakeStream([
        { type: 'token', token: 'Done' },
        { type: 'usage', usage: { inputTokens: 25, outputTokens: 12 } },
      ]),
    );

    const emit = vi.fn();
    await orchestrator.handle(session.id, 'Usage test', {
      workspacePath: '/workspace/project',
      emit,
    });

    // Extract message:done events
    const doneEvents = emit.mock.calls.filter(
      ([type]: [string]) => type === 'message:done',
    );

    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0][1]).toMatchObject({
      sessionId: session.id,
      usage: { inputTokens: 25, outputTokens: 12 },
    });
  });

  // ========================================================================
  // Req 9.3: Turn saved to SQLite after completion
  // ========================================================================

  it('should save user message and assistant response to SQLite after completion', async () => {
    const session = sessionManager.createSession('/workspace/project');

    mockStreamComplete.mockImplementation(() =>
      fakeStream([
        { type: 'token', token: 'AI response text' },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      ]),
    );

    const emit = vi.fn();
    await orchestrator.handle(session.id, 'Save this message', {
      workspacePath: '/workspace/project',
      emit,
    });

    // Verify messages were persisted to SQLite
    const history = sessionManager.loadHistory(session.id);

    // Should contain the user message and assistant response
    expect(history.length).toBe(2);

    const userMsg = history.find(m => m.role === 'user');
    const assistantMsg = history.find(m => m.role === 'assistant');

    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe('Save this message');

    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toBe('AI response text');
  });

  // ========================================================================
  // Req 10.3: Turn text indexed to LanceDB after completion
  // ========================================================================

  it('should index the turn text to LanceDB after completion', async () => {
    const session = sessionManager.createSession('/workspace/project');

    mockStreamComplete.mockImplementation(() =>
      fakeStream([
        { type: 'token', token: 'Indexed response' },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      ]),
    );

    const emit = vi.fn();
    await orchestrator.handle(session.id, 'Index this turn', {
      workspacePath: '/workspace/project',
      emit,
    });

    // The embedder should have been called for the turn text
    // Once for the RAG search query, and then for each chunk during indexing
    expect(mockEmbed).toHaveBeenCalled();

    // LanceDB insert should have been called with vector chunks
    expect(mockLanceInsert).toHaveBeenCalled();

    // Verify the inserted chunks contain the turn text
    expect(lanceInserted.length).toBeGreaterThan(0);
    const allChunkTexts = lanceInserted.flat().map(c => c.text);
    const combinedText = allChunkTexts.join(' ');
    expect(combinedText).toContain('Index this turn');
    expect(combinedText).toContain('Indexed response');
  });

  // ========================================================================
  // Full pipeline: end-to-end flow
  // ========================================================================

  it('should execute the complete chat flow: message → context → dispatch → stream → save → index', async () => {
    // 1. Create session
    const session = sessionManager.createSession('/workspace/full-test');

    // 2. Pre-populate some history to verify context building
    sessionManager.saveMessage(session.id, { role: 'user', content: 'Earlier message' });
    sessionManager.saveMessage(session.id, { role: 'assistant', content: 'Earlier reply' });

    // 3. Mock memory search to return a relevant chunk
    mockLanceSimilaritySearch.mockResolvedValue([
      { id: 'mem-1', source: 'conversation', text: 'Previously discussed topic' },
    ]);

    // 4. Mock OpenClaude streaming response
    mockStreamComplete.mockImplementation(() =>
      fakeStream([
        { type: 'token', token: 'The ' },
        { type: 'token', token: 'answer ' },
        { type: 'token', token: 'is 42.' },
        { type: 'usage', usage: { inputTokens: 50, outputTokens: 15 } },
      ]),
    );

    const emit = vi.fn();

    // 5. Handle the message through the orchestrator
    const result = await orchestrator.handle(
      session.id,
      'What is the meaning of life?',
      { workspacePath: '/workspace/full-test', emit },
    );

    // --- Verify dispatch result ---
    expect(result.agent).toBe('test-coder');
    expect(result.text).toBe('The answer is 42.');
    expect(result.cancelled).toBe(false);

    // --- Verify agent:status events were emitted ---
    const statusEvents = emit.mock.calls.filter(
      ([type]: [string]) => type === 'agent:status',
    );
    expect(statusEvents.length).toBeGreaterThanOrEqual(2);
    expect(statusEvents[0][1]).toMatchObject({ status: 'running' });
    expect(statusEvents[statusEvents.length - 1][1]).toMatchObject({ status: 'done' });

    // --- Verify token streaming events ---
    const tokenEvents = emit.mock.calls.filter(
      ([type]: [string]) => type === 'message:token',
    );
    expect(tokenEvents.length).toBe(3);

    // --- Verify message:done event ---
    const doneEvents = emit.mock.calls.filter(
      ([type]: [string]) => type === 'message:done',
    );
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0][1].usage).toMatchObject({
      inputTokens: 50,
      outputTokens: 15,
    });

    // --- Verify turn saved to SQLite ---
    const history = sessionManager.loadHistory(session.id);
    // 2 pre-existing + 2 new (user + assistant)
    expect(history.length).toBe(4);
    expect(history[2].role).toBe('user');
    expect(history[2].content).toBe('What is the meaning of life?');
    expect(history[3].role).toBe('assistant');
    expect(history[3].content).toBe('The answer is 42.');

    // --- Verify turn indexed to LanceDB ---
    expect(mockLanceInsert).toHaveBeenCalled();
    const indexedChunks = lanceInserted.flat();
    expect(indexedChunks.length).toBeGreaterThan(0);

    // Each indexed chunk should have a vector
    for (const chunk of indexedChunks) {
      expect(chunk.vector).toBeInstanceOf(Float32Array);
      expect(chunk.vector.length).toBeGreaterThan(0);
    }

    // The indexed text should contain both user message and assistant response
    const allText = indexedChunks.map(c => c.text).join(' ');
    expect(allText).toContain('What is the meaning of life?');
    expect(allText).toContain('The answer is 42.');
  });

  // ========================================================================
  // Edge case: empty assistant response should still save user message
  // ========================================================================

  it('should save user message even when assistant response is empty', async () => {
    const session = sessionManager.createSession('/workspace/edge');

    // Stream completes with no tokens (e.g., cancelled or empty response)
    mockStreamComplete.mockImplementation(() =>
      fakeStream([
        { type: 'usage', usage: { inputTokens: 5, outputTokens: 0 } },
      ]),
    );

    const emit = vi.fn();
    await orchestrator.handle(session.id, 'Empty response test', {
      workspacePath: '/workspace/edge',
      emit,
    });

    const history = sessionManager.loadHistory(session.id);
    // User message should be saved; assistant message should NOT be saved (empty text)
    expect(history.length).toBe(1);
    expect(history[0].role).toBe('user');
    expect(history[0].content).toBe('Empty response test');
  });

  // ========================================================================
  // Memory RAG: search is performed and results feed into context building
  // ========================================================================

  it('should perform RAG search and use memory chunks when building context', async () => {
    const session = sessionManager.createSession('/workspace/rag-test');

    // Mock memory search to return chunks
    const ragChunks: Chunk[] = [
      { id: 'rag-1', source: 'vault', text: 'Important vault note about TypeScript' },
      { id: 'rag-2', source: 'conversation', text: 'Previous discussion about testing' },
    ];
    mockLanceSimilaritySearch.mockResolvedValue(ragChunks);

    // Spy on buildContextWindow to verify memory chunks are passed in
    const buildCtxSpy = vi.spyOn(sessionManager, 'buildContextWindow');

    let capturedRequest: CompletionRequest | undefined;
    mockStreamComplete.mockImplementation((req: CompletionRequest) => {
      capturedRequest = req;
      return fakeStream([
        { type: 'token', token: 'RAG response' },
      ]);
    });

    const emit = vi.fn();
    await orchestrator.handle(session.id, 'Tell me about TypeScript testing', {
      workspacePath: '/workspace/rag-test',
      emit,
    });

    // Verify RAG search was performed with the user message
    expect(mockEmbed).toHaveBeenCalledWith('Tell me about TypeScript testing');
    expect(mockLanceSimilaritySearch).toHaveBeenCalledWith(
      expect.any(Array),
      5, // default topK
      undefined,
    );

    // Verify buildContextWindow was called with the retrieved memory chunks
    expect(buildCtxSpy).toHaveBeenCalledWith(
      session.id,
      ragChunks,
      expect.any(String), // system prompt
    );

    // Verify the request was sent to OpenClaude (agent engine transforms it)
    expect(capturedRequest).toBeDefined();
    expect(capturedRequest!.messages.length).toBeGreaterThan(0);

    // The user message should be present in the final request
    const userMessages = capturedRequest!.messages.filter(m => m.role === 'user');
    expect(userMessages.some(m => m.content === 'Tell me about TypeScript testing')).toBe(true);

    buildCtxSpy.mockRestore();
  });
});
