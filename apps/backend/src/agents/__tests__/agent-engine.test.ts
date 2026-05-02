/**
 * Unit tests for Agent Engine.
 *
 * Validates: Requirements 7.2, 7.4, 8.1
 *
 * - 7.2: Intent routing dispatches to the first matching agent in priority order
 * - 7.4: Tool allowlist enforcement rejects unauthorized tool calls
 * - 8.1: Cancel terminates the active gRPC stream for a session
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Agent,
  CompletionRequest,
  CompletionChunk,
  ToolResult,
} from '@clover/shared';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test
// ---------------------------------------------------------------------------

// Mock glob so loadAgents doesn't scan the filesystem
const mockGlob = vi.fn<(pattern: string, opts?: unknown) => Promise<string[]>>();
vi.mock('glob', () => ({
  glob: (...args: unknown[]) => mockGlob(args[0] as string, args[1]),
}));

// Mock the OpenClaude gRPC client — streamComplete returns an async generator
const mockStreamComplete = vi.fn<(req: CompletionRequest) => AsyncGenerator<CompletionChunk>>();
vi.mock('../../openclaude/openclaude.client.js', () => ({
  streamComplete: (...args: unknown[]) => mockStreamComplete(args[0] as CompletionRequest),
}));

// Mock the tool registry — execute returns a ToolResult
const mockToolExecute = vi.fn<(name: string, args: unknown, ctx: unknown) => Promise<ToolResult>>();
vi.mock('../../tools/tool-registry.js', () => ({
  execute: (...args: unknown[]) => mockToolExecute(args[0] as string, args[1], args[2]),
}));

// Mock the Ollama client — chat returns a string
const mockOllamaChat = vi.fn<(messages: unknown[], model: string) => Promise<string>>();
vi.mock('../../ollama/ollama.client.js', () => ({
  chat: (...args: unknown[]) => mockOllamaChat(args[0] as unknown[], args[1] as string),
}));

// ---------------------------------------------------------------------------
// Module under test — we dynamically import to get a fresh module per test
// ---------------------------------------------------------------------------

type AgentEngineModule = typeof import('../agent-engine.js');

/**
 * Dynamically import a fresh agent-engine module. Because the module keeps
 * agents in module-level state, we use vi.resetModules() + dynamic import
 * to get a clean slate for each test group.
 */
async function freshModule(): Promise<AgentEngineModule> {
  vi.resetModules();
  return await import('../agent-engine.js');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal Agent for testing. */
function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    name: overrides.name ?? 'test-agent',
    systemPrompt: overrides.systemPrompt ?? 'You are a test agent.',
    allowedTools: overrides.allowedTools ?? ['read-file', 'list-files'],
    matchesIntent: overrides.matchesIntent ?? (() => true),
    maxTurns: overrides.maxTurns ?? 10,
  };
}

/** Create a minimal CompletionRequest with a user message. */
function makeRequest(userMessage: string): CompletionRequest {
  return {
    messages: [{ role: 'user', content: userMessage }],
    tools: [
      { name: 'read-file', description: 'Read a file', inputSchema: {} },
      { name: 'write-file', description: 'Write a file', inputSchema: {} },
      { name: 'list-files', description: 'List files', inputSchema: {} },
      { name: 'execute-command', description: 'Run a command', inputSchema: {} },
    ],
  };
}

/** Create an async generator that yields the given chunks. */
async function* fakeStream(chunks: CompletionChunk[]): AsyncGenerator<CompletionChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGlob.mockResolvedValue([]);
    mockToolExecute.mockResolvedValue({ success: true, output: 'tool done' });
    mockOllamaChat.mockResolvedValue('Ollama fallback response');
  });

  // ========================================================================
  // Req 7.2: Intent routing dispatches to correct agent
  // ========================================================================

  describe('intent routing (Req 7.2)', () => {
    it('should dispatch to the first agent whose matchesIntent returns true', async () => {
      const mod = await freshModule();

      const agentA = makeAgent({
        name: 'agent-a',
        matchesIntent: () => false,
      });
      const agentB = makeAgent({
        name: 'agent-b',
        matchesIntent: (msg) => msg.includes('build'),
      });
      const agentC = makeAgent({
        name: 'agent-c',
        matchesIntent: () => true, // catch-all
      });

      mod.registerAgent(agentA);
      mod.registerAgent(agentB);
      mod.registerAgent(agentC);

      mockStreamComplete.mockImplementation(() =>
        fakeStream([
          { type: 'token', token: 'Hello' },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
        ]),
      );

      const result = await mod.dispatch(
        makeRequest('please build the project'),
        'session-1',
        { workspacePath: '/workspace', emit: vi.fn() },
      );

      // agent-b should match because the message contains "build"
      expect(result.agent).toBe('agent-b');
      expect(result.text).toBe('Hello');
      expect(result.cancelled).toBe(false);
    });

    it('should throw NoMatchingAgentError when no agent matches', async () => {
      const mod = await freshModule();

      const agent = makeAgent({
        name: 'picky-agent',
        matchesIntent: () => false,
      });
      mod.registerAgent(agent);

      await expect(
        mod.dispatch(makeRequest('something random'), 'session-2', {
          workspacePath: '/workspace',
          emit: vi.fn(),
        }),
      ).rejects.toThrow(mod.NoMatchingAgentError);
    });

    it('should respect priority order — first registered agent wins on tie', async () => {
      const mod = await freshModule();

      const highPriority = makeAgent({
        name: 'high-priority',
        matchesIntent: () => true,
      });
      const lowPriority = makeAgent({
        name: 'low-priority',
        matchesIntent: () => true,
      });

      mod.registerAgent(highPriority);
      mod.registerAgent(lowPriority);

      mockStreamComplete.mockImplementation(() =>
        fakeStream([{ type: 'token', token: 'ok' }]),
      );

      const result = await mod.dispatch(
        makeRequest('do something'),
        'session-3',
        { workspacePath: '/workspace', emit: vi.fn() },
      );

      expect(result.agent).toBe('high-priority');
    });

    it('matchIntent should return the first matching agent', async () => {
      const mod = await freshModule();

      const agentX = makeAgent({
        name: 'agent-x',
        matchesIntent: (msg) => msg.includes('search'),
      });
      const agentY = makeAgent({
        name: 'agent-y',
        matchesIntent: () => true,
      });

      mod.registerAgent(agentX);
      mod.registerAgent(agentY);

      const matched = mod.matchIntent('search for docs');
      expect(matched?.name).toBe('agent-x');
    });

    it('matchIntent should return undefined when no agent matches', async () => {
      const mod = await freshModule();

      const agent = makeAgent({
        name: 'no-match',
        matchesIntent: () => false,
      });
      mod.registerAgent(agent);

      const matched = mod.matchIntent('hello');
      expect(matched).toBeUndefined();
    });

    it('should emit agent:status running and done events during dispatch', async () => {
      const mod = await freshModule();

      const agent = makeAgent({ name: 'status-agent' });
      mod.registerAgent(agent);

      mockStreamComplete.mockImplementation(() =>
        fakeStream([{ type: 'token', token: 'hi' }]),
      );

      const emit = vi.fn();
      await mod.dispatch(makeRequest('do it'), 'session-status', {
        workspacePath: '/workspace',
        emit,
      });

      // Check that agent:status was emitted with "running" and "done"
      const statusCalls = emit.mock.calls.filter(
        ([type]: [string]) => type === 'agent:status',
      );
      expect(statusCalls.length).toBeGreaterThanOrEqual(2);
      expect(statusCalls[0]![1]).toMatchObject({
        agent: 'status-agent',
        status: 'running',
      });
      expect(statusCalls[statusCalls.length - 1]![1]).toMatchObject({
        agent: 'status-agent',
        status: 'done',
      });
    });
  });

  // ========================================================================
  // Req 7.4: Tool allowlist enforcement rejects unauthorized tools
  // ========================================================================

  describe('tool allowlist enforcement (Req 7.4)', () => {
    it('should execute tool calls that are in the agent allowedTools list', async () => {
      const mod = await freshModule();

      const agent = makeAgent({
        name: 'allowed-tools-agent',
        allowedTools: ['read-file', 'list-files'],
      });
      mod.registerAgent(agent);

      mockStreamComplete.mockImplementation(() =>
        fakeStream([
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-1',
              name: 'read-file',
              arguments: '{"path":"src/index.ts"}',
            },
          },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
        ]),
      );

      const emit = vi.fn();
      await mod.dispatch(makeRequest('read the file'), 'session-allowed', {
        workspacePath: '/workspace',
        emit,
      });

      // tool-registry.execute should have been called for the allowed tool
      expect(mockToolExecute).toHaveBeenCalledTimes(1);
      expect(mockToolExecute).toHaveBeenCalledWith(
        'read-file',
        { path: 'src/index.ts' },
        expect.objectContaining({ workspacePath: '/workspace' }),
      );
    });

    it('should reject tool calls NOT in the agent allowedTools list', async () => {
      const mod = await freshModule();

      const agent = makeAgent({
        name: 'restricted-agent',
        allowedTools: ['read-file'], // only read-file allowed
      });
      mod.registerAgent(agent);

      mockStreamComplete.mockImplementation(() =>
        fakeStream([
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-2',
              name: 'execute-command', // NOT in allowedTools
              arguments: '{"cmd":"rm -rf /"}',
            },
          },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
        ]),
      );

      const emit = vi.fn();
      await mod.dispatch(makeRequest('run a command'), 'session-restricted', {
        workspacePath: '/workspace',
        emit,
      });

      // tool-registry.execute should NOT have been called
      expect(mockToolExecute).not.toHaveBeenCalled();

      // A tool:result event should have been emitted with success=false
      const toolResultCalls = emit.mock.calls.filter(
        ([type]: [string]) => type === 'tool:result',
      );
      expect(toolResultCalls.length).toBe(1);
      expect(toolResultCalls[0]![1]).toMatchObject({
        toolName: 'execute-command',
        success: false,
      });
    });

    it('should allow some tools and reject others in the same stream', async () => {
      const mod = await freshModule();

      const agent = makeAgent({
        name: 'mixed-agent',
        allowedTools: ['read-file'],
        maxTurns: 10,
      });
      mod.registerAgent(agent);

      mockStreamComplete.mockImplementation(() =>
        fakeStream([
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-ok',
              name: 'read-file',
              arguments: '{"path":"a.ts"}',
            },
          },
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-bad',
              name: 'write-file', // NOT allowed
              arguments: '{"path":"b.ts","content":"x"}',
            },
          },
        ]),
      );

      const emit = vi.fn();
      await mod.dispatch(makeRequest('read and write'), 'session-mixed', {
        workspacePath: '/workspace',
        emit,
      });

      // Only the allowed tool should have been executed via the registry
      expect(mockToolExecute).toHaveBeenCalledTimes(1);
      expect(mockToolExecute).toHaveBeenCalledWith(
        'read-file',
        expect.anything(),
        expect.anything(),
      );

      // Both tool:result events should be emitted
      const toolResults = emit.mock.calls.filter(
        ([type]: [string]) => type === 'tool:result',
      );
      expect(toolResults.length).toBe(2);

      // First result (read-file) should be successful
      expect(toolResults[0]![1]).toMatchObject({
        toolName: 'read-file',
        success: true,
      });

      // Second result (write-file) should be rejected
      expect(toolResults[1]![1]).toMatchObject({
        toolName: 'write-file',
        success: false,
      });
    });

    it('ToolNotAllowedError should have correct name and message', async () => {
      const mod = await freshModule();
      const error = new mod.ToolNotAllowedError('delete-file', 'reviewer');

      expect(error.name).toBe('ToolNotAllowedError');
      expect(error.message).toContain('reviewer');
      expect(error.message).toContain('delete-file');
      expect(error).toBeInstanceOf(Error);
    });
  });

  // ========================================================================
  // Req 8.1: Cancel terminates gRPC stream
  // ========================================================================

  describe('cancel (Req 8.1)', () => {
    it('should terminate the stream and set cancelled=true when cancel is called', async () => {
      const mod = await freshModule();

      const agent = makeAgent({ name: 'cancel-agent' });
      mod.registerAgent(agent);

      // Create a slow stream that yields tokens with delays
      async function* slowStream(): AsyncGenerator<CompletionChunk> {
        yield { type: 'token', token: 'first ' };
        await new Promise((r) => setTimeout(r, 100));
        yield { type: 'token', token: 'second ' };
        await new Promise((r) => setTimeout(r, 100));
        yield { type: 'token', token: 'third' };
      }

      mockStreamComplete.mockImplementation(() => slowStream());

      const emit = vi.fn();

      // Schedule cancel after a short delay
      setTimeout(() => mod.cancel('session-cancel'), 50);

      const result = await mod.dispatch(
        makeRequest('long task'),
        'session-cancel',
        { workspacePath: '/workspace', emit },
      );

      expect(result.cancelled).toBe(true);
      expect(result.agent).toBe('cancel-agent');
      // Should have received at most the first token before cancellation
      expect(result.text.length).toBeLessThan('first second third'.length);
    });

    it('should emit agent:status done with cancellation detail after cancel', async () => {
      const mod = await freshModule();

      const agent = makeAgent({ name: 'cancel-status-agent' });
      mod.registerAgent(agent);

      async function* slowStream(): AsyncGenerator<CompletionChunk> {
        yield { type: 'token', token: 'tok' };
        await new Promise((r) => setTimeout(r, 200));
        yield { type: 'token', token: 'en' };
      }

      mockStreamComplete.mockImplementation(() => slowStream());

      const emit = vi.fn();
      setTimeout(() => mod.cancel('session-cancel-status'), 50);

      await mod.dispatch(
        makeRequest('cancel me'),
        'session-cancel-status',
        { workspacePath: '/workspace', emit },
      );

      // The last agent:status event should indicate done with cancellation
      const statusCalls = emit.mock.calls.filter(
        ([type]: [string]) => type === 'agent:status',
      );
      const lastStatus = statusCalls[statusCalls.length - 1]![1];
      expect(lastStatus.status).toBe('done');
      expect(lastStatus.detail).toBe('cancelled');
    });

    it('should support cancellation via external AbortSignal', async () => {
      const mod = await freshModule();

      const agent = makeAgent({ name: 'signal-agent' });
      mod.registerAgent(agent);

      async function* slowStream(): AsyncGenerator<CompletionChunk> {
        yield { type: 'token', token: 'a' };
        await new Promise((r) => setTimeout(r, 200));
        yield { type: 'token', token: 'b' };
      }

      mockStreamComplete.mockImplementation(() => slowStream());

      const controller = new AbortController();
      const emit = vi.fn();

      // Abort via the external signal after a short delay
      setTimeout(() => controller.abort(), 50);

      const result = await mod.dispatch(
        makeRequest('abort me'),
        'session-signal',
        { workspacePath: '/workspace', emit, signal: controller.signal },
      );

      expect(result.cancelled).toBe(true);
    });

    it('cancel should be a no-op when no dispatch is active for the session', async () => {
      const mod = await freshModule();
      // Should not throw
      expect(() => mod.cancel('nonexistent-session')).not.toThrow();
    });

    it('should handle already-aborted signal gracefully', async () => {
      const mod = await freshModule();

      const agent = makeAgent({ name: 'pre-aborted-agent' });
      mod.registerAgent(agent);

      mockStreamComplete.mockImplementation(() =>
        fakeStream([{ type: 'token', token: 'should not appear' }]),
      );

      const controller = new AbortController();
      controller.abort(); // Already aborted before dispatch

      const emit = vi.fn();
      const result = await mod.dispatch(
        makeRequest('pre-aborted'),
        'session-pre-abort',
        { workspacePath: '/workspace', emit, signal: controller.signal },
      );

      expect(result.cancelled).toBe(true);
    });
  });

  // ========================================================================
  // Agent registration
  // ========================================================================

  describe('registerAgent and listAgents', () => {
    it('should register an agent and include it in listAgents', async () => {
      const mod = await freshModule();

      const agent = makeAgent({ name: 'reg-test-agent' });
      mod.registerAgent(agent);

      expect(mod.listAgents()).toContain('reg-test-agent');
    });

    it('should replace an agent with the same name on re-registration', async () => {
      const mod = await freshModule();

      const agentV1 = makeAgent({
        name: 'dup-agent',
        systemPrompt: 'v1',
      });
      const agentV2 = makeAgent({
        name: 'dup-agent',
        systemPrompt: 'v2',
      });

      mod.registerAgent(agentV1);
      mod.registerAgent(agentV2);

      // Should only appear once
      const names = mod.listAgents().filter((n) => n === 'dup-agent');
      expect(names.length).toBe(1);
    });
  });

  // ========================================================================
  // Error handling during dispatch
  // ========================================================================

  describe('error handling', () => {
    it('should emit agent:status error when stream throws and Ollama fallback also fails', async () => {
      const mod = await freshModule();

      const agent = makeAgent({ name: 'error-agent' });
      mod.registerAgent(agent);

      async function* errorStream(): AsyncGenerator<CompletionChunk> {
        yield { type: 'token', token: 'partial' };
        throw new Error('gRPC connection lost');
      }

      mockStreamComplete.mockImplementation(() => errorStream());
      mockOllamaChat.mockRejectedValue(new Error('Ollama unreachable'));

      const emit = vi.fn();

      await expect(
        mod.dispatch(makeRequest('fail'), 'session-error', {
          workspacePath: '/workspace',
          emit,
        }),
      ).rejects.toThrow('Ollama unreachable');

      const statusCalls = emit.mock.calls.filter(
        ([type]: [string]) => type === 'agent:status',
      );
      const lastStatus = statusCalls[statusCalls.length - 1]![1];
      expect(lastStatus.status).toBe('error');
      expect(lastStatus.detail).toContain('Ollama unreachable');
    });

    it('should handle malformed tool call arguments gracefully', async () => {
      const mod = await freshModule();

      const agent = makeAgent({
        name: 'bad-json-agent',
        allowedTools: ['read-file'],
      });
      mod.registerAgent(agent);

      mockStreamComplete.mockImplementation(() =>
        fakeStream([
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-bad-json',
              name: 'read-file',
              arguments: '{invalid json}',
            },
          },
        ]),
      );

      const emit = vi.fn();
      // Should not throw — malformed JSON is handled internally
      await mod.dispatch(makeRequest('bad json'), 'session-bad-json', {
        workspacePath: '/workspace',
        emit,
      });

      // tool-registry.execute should NOT have been called
      expect(mockToolExecute).not.toHaveBeenCalled();

      // A tool:result event should indicate failure
      const toolResults = emit.mock.calls.filter(
        ([type]: [string]) => type === 'tool:result',
      );
      expect(toolResults.length).toBe(1);
      expect(toolResults[0]![1].success).toBe(false);
    });
  });
});
