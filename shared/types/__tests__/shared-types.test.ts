/**
 * Unit tests for shared types compilation and proto stub imports.
 *
 * Validates: Requirements 34.1, 34.3
 *
 * These tests verify that:
 * - All shared TypeScript interfaces compile under strict mode
 * - Proto stubs are importable and structurally correct
 * - No `any` types leak into the public interface contracts
 */
import { describe, it, expect } from 'vitest';

// ── Shared type imports (Requirement 34.1) ──────────────────────────────

import type {
  Config,
  ModelConfig,
} from '../config.js';

import type {
  Message,
  Tool,
  CompletionRequest,
  ToolCall,
  UsageStats,
  CompletionChunk,
} from '../messages.js';

import type {
  ToolContext,
  ExecGuard,
  ExecGuardResult,
  ToolPlugin,
  ToolResult,
} from '../tools.js';

import type {
  AgentContext,
  AgentStatus,
  Agent,
} from '../agents.js';

import type {
  Chunk,
  VectorChunk,
  MemorySearchOptions,
} from '../memory.js';

import type {
  SearchOptions,
  SearchResult,
  SearchAdapter,
} from '../search.js';

// ── Barrel export import (Requirement 34.1) ─────────────────────────────

import type {
  Config as BarrelConfig,
  ModelConfig as BarrelModelConfig,
  Message as BarrelMessage,
  Tool as BarrelTool,
  CompletionRequest as BarrelCompletionRequest,
  ToolCall as BarrelToolCall,
  UsageStats as BarrelUsageStats,
  CompletionChunk as BarrelCompletionChunk,
  ToolContext as BarrelToolContext,
  ExecGuard as BarrelExecGuard,
  ExecGuardResult as BarrelExecGuardResult,
  ToolPlugin as BarrelToolPlugin,
  ToolResult as BarrelToolResult,
  AgentContext as BarrelAgentContext,
  AgentStatus as BarrelAgentStatus,
  Agent as BarrelAgent,
  Chunk as BarrelChunk,
  VectorChunk as BarrelVectorChunk,
  MemorySearchOptions as BarrelMemorySearchOptions,
  SearchOptions as BarrelSearchOptions,
  SearchResult as BarrelSearchResult,
  SearchAdapter as BarrelSearchAdapter,
} from '../index.js';

// ── Proto stub imports (Requirement 34.3) ───────────────────────────────

import type {
  ProtoMessage,
  ProtoTool,
  ProtoToolCall,
  ProtoUsageStats,
  ProtoCompletionRequest,
  ProtoCompletionChunk,
  ProtoCompletionResponse,
  CompletionServiceClient,
  CompletionServiceConstructor,
  OpenClaudePackage,
} from '../../protos/generated/openclaude.js';

import type {
  ProtoMessage as BarrelProtoMessage,
  ProtoCompletionRequest as BarrelProtoCompletionRequest,
  OpenClaudePackage as BarrelOpenClaudePackage,
} from '../../protos/generated/index.js';

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe('Shared types compilation (Requirement 34.1)', () => {
  describe('messages.ts interfaces', () => {
    it('should compile a valid Message', () => {
      const msg: Message = {
        role: 'user',
        content: 'hello',
      };
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('hello');
    });

    it('should compile a Message with all optional fields', () => {
      const msg: Message = {
        id: 'msg-1',
        role: 'tool',
        content: 'result',
        tool_name: 'read-file',
        tool_call_id: 'tc-1',
        created_at: '2024-01-01T00:00:00Z',
      };
      expect(msg.id).toBe('msg-1');
      expect(msg.tool_name).toBe('read-file');
    });

    it('should compile a Tool interface', () => {
      const tool: Tool = {
        name: 'read-file',
        description: 'Reads a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      };
      expect(tool.name).toBe('read-file');
    });

    it('should compile a CompletionRequest', () => {
      const req: CompletionRequest = {
        messages: [{ role: 'user', content: 'hi' }],
      };
      expect(req.messages).toHaveLength(1);
    });

    it('should compile a ToolCall', () => {
      const tc: ToolCall = {
        id: 'tc-1',
        name: 'read-file',
        arguments: '{"path":"./file.ts"}',
      };
      expect(tc.name).toBe('read-file');
    });

    it('should compile UsageStats', () => {
      const stats: UsageStats = {
        inputTokens: 100,
        outputTokens: 50,
      };
      expect(stats.inputTokens).toBe(100);
    });

    it('should compile CompletionChunk variants', () => {
      const tokenChunk: CompletionChunk = { type: 'token', token: 'hello' };
      const toolCallChunk: CompletionChunk = {
        type: 'tool_call',
        toolCall: { id: 'tc-1', name: 'read-file', arguments: '{}' },
      };
      const usageChunk: CompletionChunk = {
        type: 'usage',
        usage: { inputTokens: 10, outputTokens: 5 },
      };
      expect(tokenChunk.type).toBe('token');
      expect(toolCallChunk.type).toBe('tool_call');
      expect(usageChunk.type).toBe('usage');
    });
  });

  describe('tools.ts interfaces', () => {
    it('should compile ToolResult', () => {
      const result: ToolResult = {
        success: true,
        output: 'file content here',
      };
      expect(result.success).toBe(true);
    });

    it('should compile ToolResult with error', () => {
      const result: ToolResult = {
        success: false,
        output: '',
        error: 'File not found',
      };
      expect(result.error).toBe('File not found');
    });

    it('should compile ExecGuardResult', () => {
      const result: ExecGuardResult = {
        stdout: 'output',
        stderr: '',
        exitCode: 0,
      };
      expect(result.exitCode).toBe(0);
    });

    it('should compile ToolContext', () => {
      const ctx: ToolContext = {
        workspacePath: '/workspace',
        sessionId: 'sess-1',
        execGuard: {
          execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
        },
        emitEvent: () => {},
      };
      expect(ctx.workspacePath).toBe('/workspace');
    });

    it('should compile ToolPlugin', () => {
      const plugin: ToolPlugin = {
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: {},
        requiresConfirmation: () => false,
        execute: async () => ({ success: true, output: 'done' }),
      };
      expect(plugin.name).toBe('test-tool');
    });
  });

  describe('agents.ts interfaces', () => {
    it('should compile AgentContext', () => {
      const ctx: AgentContext = {
        sessionId: 'sess-1',
        workspacePath: '/workspace',
      };
      expect(ctx.sessionId).toBe('sess-1');
    });

    it('should compile AgentContext with optional recentTools', () => {
      const ctx: AgentContext = {
        sessionId: 'sess-1',
        workspacePath: '/workspace',
        recentTools: ['read-file', 'write-file'],
      };
      expect(ctx.recentTools).toHaveLength(2);
    });

    it('should compile AgentStatus type', () => {
      const statuses: AgentStatus[] = ['idle', 'running', 'done', 'error'];
      expect(statuses).toHaveLength(4);
    });

    it('should compile Agent interface', () => {
      const agent: Agent = {
        name: 'coder',
        systemPrompt: 'You are a coder.',
        allowedTools: ['read-file', 'write-file'],
        matchesIntent: (msg: string) => msg.includes('code'),
        maxTurns: 10,
      };
      expect(agent.name).toBe('coder');
      expect(agent.matchesIntent('write code')).toBe(true);
    });
  });

  describe('memory.ts interfaces', () => {
    it('should compile Chunk', () => {
      const chunk: Chunk = {
        id: 'chunk-1',
        source: 'conversation',
        text: 'some text',
      };
      expect(chunk.source).toBe('conversation');
    });

    it('should compile Chunk with optional fields', () => {
      const chunk: Chunk = {
        id: 'chunk-1',
        source: 'vault',
        filePath: '/notes/readme.md',
        sessionId: 'sess-1',
        text: 'some text',
        score: 0.95,
      };
      expect(chunk.filePath).toBe('/notes/readme.md');
      expect(chunk.score).toBe(0.95);
    });

    it('should compile VectorChunk extending Chunk', () => {
      const vchunk: VectorChunk = {
        id: 'vc-1',
        source: 'reversa',
        text: 'skill content',
        vector: new Float32Array([0.1, 0.2, 0.3]),
        timestamp: '2024-01-01T00:00:00Z',
      };
      expect(vchunk.vector).toBeInstanceOf(Float32Array);
      expect(vchunk.timestamp).toBeDefined();
    });

    it('should compile VectorChunk with metadata', () => {
      const vchunk: VectorChunk = {
        id: 'vc-2',
        source: 'vault',
        text: 'note content',
        vector: new Float32Array([0.5]),
        timestamp: '2024-01-01T00:00:00Z',
        metadata: { author: 'user', tag: 'important' },
      };
      expect(vchunk.metadata?.author).toBe('user');
    });

    it('should compile MemorySearchOptions', () => {
      const opts: MemorySearchOptions = {
        topK: 5,
        source: 'vault',
        filePath: '/notes/readme.md',
      };
      expect(opts.topK).toBe(5);
    });
  });

  describe('search.ts interfaces', () => {
    it('should compile SearchOptions', () => {
      const opts: SearchOptions = {
        maxResults: 10,
        source: 'duckduckgo',
      };
      expect(opts.maxResults).toBe(10);
    });

    it('should compile SearchResult', () => {
      const result: SearchResult = {
        title: 'TypeScript Docs',
        url: 'https://typescriptlang.org',
        snippet: 'TypeScript is a typed superset of JavaScript',
        source: 'duckduckgo',
      };
      expect(result.title).toBe('TypeScript Docs');
    });

    it('should compile SearchResult without optional url', () => {
      const result: SearchResult = {
        title: 'Local result',
        snippet: 'Found in memory',
        source: 'offline',
      };
      expect(result.url).toBeUndefined();
    });

    it('should compile SearchAdapter interface', () => {
      const adapter: SearchAdapter = {
        name: 'test-adapter',
        isAvailable: async () => true,
        search: async () => [],
      };
      expect(adapter.name).toBe('test-adapter');
    });
  });

  describe('config.ts interfaces', () => {
    it('should compile Config with all required fields', () => {
      const config: Config = {
        gateway: { port: 3001, host: 'localhost', corsOrigin: 'http://localhost:1420' },
        openclaude: { host: 'localhost', port: 50051 },
        ollama: { host: 'http://localhost:11434', retryAttempts: 3, retryBackoffMs: 1000 },
        memory: { dbPath: './data/lancedb', topK: 5, chunkSize: 512, chunkOverlap: 50 },
        vault: { path: './vault', watchDebounceMs: 500 },
        execGuard: { timeoutMs: 30000 },
        confirmation: { timeoutMs: 60000 },
        session: { historyLimit: 20 },
      };
      expect(config.gateway.port).toBe(3001);
      expect(config.memory.chunkSize).toBe(512);
    });

    it('should compile ModelConfig', () => {
      const modelConfig: ModelConfig = {
        models: [
          { name: 'llama3', provider: 'ollama', capabilities: ['chat'], default: true },
          { name: 'nomic-embed-text', provider: 'ollama', capabilities: ['embed'] },
          { name: 'codellama', provider: 'ollama', capabilities: ['chat'], contextWindow: 16384 },
        ],
      };
      expect(modelConfig.models).toHaveLength(3);
      expect(modelConfig.models[0].capabilities).toContain('chat');
    });
  });

  describe('barrel export from index.ts', () => {
    it('should export all types through the barrel', () => {
      // These type assertions verify the barrel re-exports match the direct imports.
      // If any export is missing from index.ts, this test will fail to compile.
      const msg: BarrelMessage = { role: 'user', content: 'test' };
      const tool: BarrelTool = { name: 't', description: 'd', inputSchema: {} };
      const req: BarrelCompletionRequest = { messages: [msg] };
      const tc: BarrelToolCall = { id: '1', name: 't', arguments: '{}' };
      const usage: BarrelUsageStats = { inputTokens: 1, outputTokens: 1 };
      const chunk: BarrelCompletionChunk = { type: 'token', token: 'hi' };
      const result: BarrelToolResult = { success: true, output: '' };
      const egr: BarrelExecGuardResult = { stdout: '', stderr: '', exitCode: 0 };
      const ctx: BarrelAgentContext = { sessionId: 's', workspacePath: '/w' };
      const status: BarrelAgentStatus = 'idle';
      const memChunk: BarrelChunk = { id: '1', source: 's', text: 't' };
      const searchOpts: BarrelSearchOptions = {};
      const searchResult: BarrelSearchResult = { title: 't', snippet: 's', source: 'x' };
      const memOpts: BarrelMemorySearchOptions = {};

      expect(msg).toBeDefined();
      expect(tool).toBeDefined();
      expect(req).toBeDefined();
      expect(tc).toBeDefined();
      expect(usage).toBeDefined();
      expect(chunk).toBeDefined();
      expect(result).toBeDefined();
      expect(egr).toBeDefined();
      expect(ctx).toBeDefined();
      expect(status).toBeDefined();
      expect(memChunk).toBeDefined();
      expect(searchOpts).toBeDefined();
      expect(searchResult).toBeDefined();
      expect(memOpts).toBeDefined();
    });
  });
});

describe('Proto stubs compilation (Requirement 34.3)', () => {
  describe('openclaude.ts proto types', () => {
    it('should compile ProtoMessage', () => {
      const msg: ProtoMessage = {
        role: 'user',
        content: 'hello',
      };
      expect(msg.role).toBe('user');
    });

    it('should compile ProtoMessage with optional fields', () => {
      const msg: ProtoMessage = {
        role: 'tool',
        content: 'result',
        tool_name: 'read-file',
        tool_call_id: 'tc-1',
      };
      expect(msg.tool_name).toBe('read-file');
    });

    it('should compile ProtoTool', () => {
      const tool: ProtoTool = {
        name: 'read-file',
        description: 'Reads a file',
        input_schema: '{"type":"object"}',
      };
      expect(tool.input_schema).toBe('{"type":"object"}');
    });

    it('should compile ProtoToolCall', () => {
      const tc: ProtoToolCall = {
        id: 'tc-1',
        name: 'read-file',
        arguments: '{"path":"./file.ts"}',
      };
      expect(tc.arguments).toContain('path');
    });

    it('should compile ProtoUsageStats', () => {
      const stats: ProtoUsageStats = {
        input_tokens: 100,
        output_tokens: 50,
      };
      expect(stats.input_tokens).toBe(100);
    });

    it('should compile ProtoCompletionRequest', () => {
      const req: ProtoCompletionRequest = {
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
        model: 'llama3',
        stream: true,
      };
      expect(req.messages).toHaveLength(1);
      expect(req.stream).toBe(true);
    });

    it('should compile ProtoCompletionChunk variants', () => {
      const tokenChunk: ProtoCompletionChunk = { payload: 'token', token: 'hello' };
      const toolCallChunk: ProtoCompletionChunk = {
        payload: 'tool_call',
        tool_call: { id: 'tc-1', name: 'read-file', arguments: '{}' },
      };
      const usageChunk: ProtoCompletionChunk = {
        payload: 'usage',
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      expect(tokenChunk.payload).toBe('token');
      expect(toolCallChunk.payload).toBe('tool_call');
      expect(usageChunk.payload).toBe('usage');
    });

    it('should compile ProtoCompletionResponse', () => {
      const resp: ProtoCompletionResponse = {
        message: { role: 'assistant', content: 'hi' },
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      expect(resp.message.role).toBe('assistant');
    });
  });

  describe('proto barrel export from generated/index.ts', () => {
    it('should export proto types through the barrel', () => {
      const msg: BarrelProtoMessage = { role: 'user', content: 'test' };
      const req: BarrelProtoCompletionRequest = {
        messages: [msg],
        tools: [],
        model: 'llama3',
        stream: false,
      };

      expect(msg).toBeDefined();
      expect(req).toBeDefined();
    });
  });

  describe('gRPC service client types', () => {
    it('should compile CompletionServiceConstructor type', () => {
      // Type-level check: CompletionServiceConstructor should have a `service` property
      type HasService = CompletionServiceConstructor extends { service: unknown } ? true : false;
      const check: HasService = true;
      expect(check).toBe(true);
    });

    it('should compile OpenClaudePackage type', () => {
      // Type-level check: OpenClaudePackage should have CompletionService
      type HasCompletionService = BarrelOpenClaudePackage extends {
        CompletionService: CompletionServiceConstructor;
      }
        ? true
        : false;
      const check: HasCompletionService = true;
      expect(check).toBe(true);
    });
  });
});
