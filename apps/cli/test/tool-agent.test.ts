/**
 * ToolCallingAgent tests — deterministic, no network, no Ollama.
 *
 * Covers: text-only response, single tool call, multi-step chain,
 * max-steps guard, tool execution error propagation, history inclusion,
 * and supportsTools detection.
 */

import { describe, expect, it, vi } from 'vitest';

import type { PlanIR, RunResult } from '@clover/contracts';
import type { Kernel } from '@clover/kernel';
import type { LlmProvider, ToolCallResponse } from '@clover/llm';
import { MockProvider } from '@clover/llm';

import { ToolCallingAgent, formatToolResult } from '../src/tool-agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'list_files',
    description: 'Lista arquivos num diretório.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    outputSchema: undefined,
    capabilities: [],
    pure: false,
    intent: 'read',
    origin: 'local',
  },
  {
    name: 'read_file_paginated',
    description: 'Lê o conteúdo de um arquivo por páginas.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    outputSchema: undefined,
    capabilities: [],
    pure: false,
    intent: 'read',
    origin: 'local',
  },
  {
    name: 'open_file',
    description: 'Abre um arquivo no aplicativo padrão.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    outputSchema: undefined,
    capabilities: [],
    pure: false,
    intent: 'read',
    origin: 'local',
  },
] as never[];

function makeKernel(
  submitImpl: (plan: PlanIR) => Promise<RunResult>,
): Kernel {
  return {
    listTools: () => TOOLS,
    submitPlan: vi.fn(submitImpl),
  } as unknown as Kernel;
}

function okResult(output: unknown): RunResult {
  return { taskId: 't1', status: 'done', outputs: [output], nodeOutputs: { n1: output } } as RunResult;
}

/** Provider that returns sequential responses for completeWithTools. */
function makeProvider(steps: ToolCallResponse[]): MockProvider {
  return new MockProvider('{}', ((_req) => {
    const r = steps.shift();
    return r ?? { content: '(fim)' };
  }) as import('@clover/llm').MockToolResponder);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolCallingAgent', () => {
  describe('supportsTools', () => {
    it('true when provider has completeWithTools', () => {
      const p = new MockProvider('{}', { content: 'ok' });
      const agent = new ToolCallingAgent(p, makeKernel(async () => okResult(null)), '/ws');
      expect(agent.supportsTools).toBe(true);
    });

    it('false when provider lacks completeWithTools', () => {
      const p: LlmProvider = { name: 'bare', completeStructured: async () => '{}' };
      const agent = new ToolCallingAgent(p, makeKernel(async () => okResult(null)), '/ws');
      expect(agent.supportsTools).toBe(false);
    });
  });

  describe('text-only response', () => {
    it('returns model text when no tool_calls', async () => {
      const p = makeProvider([{ content: 'Olá! Como posso ajudar?' }]);
      const agent = new ToolCallingAgent(p, makeKernel(async () => okResult(null)), '/ws');
      expect(await agent.run('oi', [])).toBe('Olá! Como posso ajudar?');
    });

    it('returns fallback when model returns empty string', async () => {
      const p = makeProvider([{ content: '' }]);
      const agent = new ToolCallingAgent(p, makeKernel(async () => okResult(null)), '/ws');
      expect(await agent.run('oi', [])).toBe('(sem resposta)');
    });
  });

  describe('single tool call', () => {
    it('executes tool and passes formatted result back', async () => {
      const toolOutput = { entries: [{ name: 'a.txt', type: 'file', size: 1024 }] };
      const submit = vi.fn(async () => okResult(toolOutput));
      const kernel = makeKernel(submit);

      const p = makeProvider([
        { content: '', tool_calls: [{ id: 'c1', function: { name: 'list_files', arguments: { path: '/desk' } } }] },
        { content: 'Encontrei 1 arquivo: a.txt.' },
      ]);

      const agent = new ToolCallingAgent(p, kernel, '/ws');
      const result = await agent.run('lista arquivos do desktop', []);

      expect(submit).toHaveBeenCalledOnce();
      const plan = (submit.mock.calls[0] as [PlanIR])[0];
      expect(plan.nodes[0].tool).toBe('list_files');
      expect(plan.nodes[0].args).toMatchObject({ path: '/desk' });
      expect(result).toBe('Encontrei 1 arquivo: a.txt.');
    });

    it('passes formatted (not raw JSON) tool result to model', async () => {
      const toolOutput = { entries: [{ name: 'readme.md', type: 'file', size: 512 }] };
      const kernel = makeKernel(async () => okResult(toolOutput));

      let capturedContent = '';
      const p = new MockProvider('{}', ((req) => {
        const lastMsg = req.messages[req.messages.length - 1];
        if (lastMsg.role === 'tool') capturedContent = lastMsg.content;
        if (req.messages.some((m) => m.role === 'tool')) return { content: 'ok' };
        return { content: '', tool_calls: [{ id: 'c1', function: { name: 'list_files', arguments: { path: '/' } } }] };
      }) as import('@clover/llm').MockToolResponder);

      const agent = new ToolCallingAgent(p, kernel, '/ws');
      await agent.run('lista', []);

      // Should contain the formatted entry, not raw JSON
      expect(capturedContent).toContain('readme.md');
      expect(capturedContent).not.toContain('"entries"');
    });
  });

  describe('multi-step chain', () => {
    it('executes two sequential tool calls before returning text', async () => {
      const submit = vi.fn()
        .mockResolvedValueOnce(okResult({ content: 'conteúdo do arquivo' }))
        .mockResolvedValueOnce(okResult({ success: true }));

      const kernel = makeKernel(submit);
      const p = makeProvider([
        { content: '', tool_calls: [{ id: 'c1', function: { name: 'read_file_paginated', arguments: { path: '/a.txt' } } }] },
        { content: '', tool_calls: [{ id: 'c2', function: { name: 'read_file_paginated', arguments: { path: '/b.txt' } } }] },
        { content: 'Li os dois arquivos.' },
      ]);

      const agent = new ToolCallingAgent(p, kernel, '/ws');
      const result = await agent.run('leia a.txt e b.txt', []);

      expect(submit).toHaveBeenCalledTimes(2);
      expect(result).toBe('Li os dois arquivos.');
    });
  });

  describe('max steps guard', () => {
    it('returns limit message after MAX_STEPS without text response', async () => {
      const kernel = makeKernel(async () => okResult({ entries: [] }));
      // Always returns tool calls, never text
      const p = new MockProvider('{}', (() => ({
        content: '',
        tool_calls: [{ id: 'c1', function: { name: 'list_files', arguments: { path: '/' } } }],
      })) as import('@clover/llm').MockToolResponder);

      const agent = new ToolCallingAgent(p, kernel, '/ws');
      const result = await agent.run('looping', []);
      expect(result).toContain('limite');
    });
  });

  describe('tool execution error', () => {
    it('passes error message to model as tool result', async () => {
      const kernel = makeKernel(async () => { throw new Error('ENOENT: arquivo não encontrado'); });

      let capturedToolMsg = '';
      const p = new MockProvider('{}', ((req) => {
        const last = req.messages[req.messages.length - 1];
        if (last.role === 'tool') {
          capturedToolMsg = last.content;
          return { content: 'Não consegui abrir o arquivo.' };
        }
        return { content: '', tool_calls: [{ id: 'c1', function: { name: 'read_file_paginated', arguments: { path: '/missing.txt' } } }] };
      }) as import('@clover/llm').MockToolResponder);

      const agent = new ToolCallingAgent(p, kernel, '/ws');
      const result = await agent.run('leia /missing.txt', []);

      expect(capturedToolMsg).toContain('ENOENT');
      expect(result).toBe('Não consegui abrir o arquivo.');
    });
  });

  describe('history', () => {
    it('includes prior turns as user/assistant messages', async () => {
      let capturedMessages: import('@clover/llm').ChatMessage[] = [];
      const p = new MockProvider('{}', ((req) => {
        capturedMessages = req.messages;
        return { content: 'ok' };
      }) as import('@clover/llm').MockToolResponder);

      const agent = new ToolCallingAgent(p, makeKernel(async () => okResult(null)), '/ws');
      await agent.run('nova mensagem', [{ user: 'pergunta anterior', assistant: 'resposta anterior' }]);

      expect(capturedMessages[0]).toMatchObject({ role: 'user', content: 'pergunta anterior' });
      expect(capturedMessages[1]).toMatchObject({ role: 'assistant', content: 'resposta anterior' });
      expect(capturedMessages[2]).toMatchObject({ role: 'user', content: 'nova mensagem' });
    });
  });

  describe('hallucination retry', () => {
    it('retries when model claims it cannot use tools at step 0', async () => {
      let callCount = 0;
      const p = new MockProvider('{}', (() => {
        callCount++;
        if (callCount === 1) return { content: 'Desculpe, não tenho capacidade de acessar arquivos.' };
        if (callCount === 2) return { content: '', tool_calls: [{ id: 'c1', function: { name: 'read_file_paginated', arguments: { path: '/f.txt' } } }] };
        return { content: 'Aqui está o conteúdo do arquivo.' };
      }) as import('@clover/llm').MockToolResponder);

      const kernel = makeKernel(async () => okResult({ lines: [{ n: 1, text: 'hello' }], eof: true }));
      const agent = new ToolCallingAgent(p, kernel, '/ws');
      const result = await agent.run('leia /f.txt', []);

      expect(callCount).toBe(3);
      expect(result).toBe('Aqui está o conteúdo do arquivo.');
    });

    it('does NOT retry for hallucinations after step 0 (tool already ran)', async () => {
      let callCount = 0;
      const p = new MockProvider('{}', (() => {
        callCount++;
        if (callCount === 1) return { content: '', tool_calls: [{ id: 'c1', function: { name: 'list_files', arguments: { path: '/' } } }] };
        return { content: 'Não posso continuar com esta operação.' };
      }) as import('@clover/llm').MockToolResponder);

      const kernel = makeKernel(async () => okResult({ entries: [] }));
      const agent = new ToolCallingAgent(p, kernel, '/ws');
      const result = await agent.run('lista e depois leia', []);

      expect(callCount).toBe(2);
      expect(result).toContain('Não posso');
    });
  });

  describe('text tool call fallback', () => {
    it('parses JSON code block tool call from content and executes it', async () => {
      const toolOutput = { entries: [{ name: 'docs.txt', type: 'file', size: 512 }] };
      const submit = vi.fn(async () => okResult(toolOutput));
      const kernel = makeKernel(submit);

      let callCount = 0;
      const p = new MockProvider('{}', (() => {
        callCount++;
        if (callCount === 1) {
          // Model outputs tool call as JSON text (no native tool_calls)
          return {
            content: 'Vou listar os arquivos:\n```json\n{"name":"list_files","arguments":{"path":"/docs"}}\n```',
          };
        }
        return { content: 'Encontrei 1 arquivo: docs.txt.' };
      }) as import('@clover/llm').MockToolResponder);

      const agent = new ToolCallingAgent(p, kernel, '/ws');
      const result = await agent.run('lista /docs', []);

      expect(submit).toHaveBeenCalledOnce();
      const plan = (submit.mock.calls[0] as [PlanIR])[0];
      expect(plan.nodes[0].tool).toBe('list_files');
      expect(plan.nodes[0].args).toMatchObject({ path: '/docs' });
      expect(result).toBe('Encontrei 1 arquivo: docs.txt.');
    });

    it('injects tool result as user message (not tool role) for weak-model compat', async () => {
      const kernel = makeKernel(async () => okResult({ entries: [{ name: 'a.txt', type: 'file', size: 100 }] }));

      let injectedContent = '';
      let callCount = 0;
      const p = new MockProvider('{}', ((req) => {
        callCount++;
        if (callCount === 1) {
          return { content: '```json\n{"name":"list_files","arguments":{"path":"/"}}\n```' };
        }
        // Capture what was injected
        const last = req.messages[req.messages.length - 1];
        injectedContent = last.content;
        return { content: 'Ok, listei.' };
      }) as import('@clover/llm').MockToolResponder);

      const agent = new ToolCallingAgent(p, kernel, '/ws');
      await agent.run('lista', []);

      // Result is injected as user message, not tool role
      expect(injectedContent).toContain('[Resultado de list_files]');
      expect(injectedContent).toContain('a.txt');
    });

    it('ignores JSON that does not match a known tool name', async () => {
      const kernel = makeKernel(async () => okResult(null));
      const submit = vi.spyOn(kernel, 'submitPlan');

      const p = makeProvider([
        // JSON with unknown tool name → should NOT be executed
        { content: '```json\n{"name":"unknown_tool","arguments":{"x":1}}\n```' },
      ]);

      const agent = new ToolCallingAgent(p, kernel, '/ws');
      await agent.run('algo', []);

      expect(submit).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// formatToolResult unit tests
// ---------------------------------------------------------------------------

describe('formatToolResult', () => {
  it('handles null/undefined', () => {
    expect(formatToolResult(null)).toBe('(sem resultado)');
    expect(formatToolResult(undefined)).toBe('(sem resultado)');
  });

  it('returns string as-is', () => {
    expect(formatToolResult('hello world')).toBe('hello world');
  });

  it('formats dir entries array (type/name/size)', () => {
    const entries = [
      { name: 'a.txt', type: 'file', size: 2048 },
      { name: 'sub', type: 'dir', size: 0 },
    ];
    const result = formatToolResult(entries);
    expect(result).toContain('📄 a.txt (2 KB)');
    expect(result).toContain('📁 sub');
  });

  it('formats { entries: [...] } — list_files output', () => {
    const output = { entries: [{ name: 'x.ts', type: 'file', size: 512 }] };
    const result = formatToolResult(output);
    expect(result).toContain('📄 x.ts');
  });

  it('formats { lines: [...] } — read_file_paginated output', () => {
    const output = {
      path: '/test.txt',
      lines: [{ n: 1, text: 'line one' }, { n: 2, text: 'line two' }],
      eof: true,
    };
    const result = formatToolResult(output);
    expect(result).toBe('line one\nline two');
  });

  it('returns (arquivo vazio) for empty lines', () => {
    expect(formatToolResult({ lines: [] })).toBe('(arquivo vazio)');
  });

  it('extracts { content: string }', () => {
    expect(formatToolResult({ content: 'file body' })).toBe('file body');
  });

  it('falls back to JSON for unknown objects', () => {
    const obj = { foo: 'bar', baz: 42 };
    expect(formatToolResult(obj)).toBe(JSON.stringify(obj));
  });
});
