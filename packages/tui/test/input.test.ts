import { describe, expect, it } from 'vitest';

import { UsageCounter, formatUsage, parseSlash, processInput } from '@clover/tui';

describe('parseSlash', () => {
  it('parses slash commands with args', () => {
    expect(parseSlash('/model llama3')).toEqual({ name: 'model', args: ['llama3'], raw: '/model llama3' });
    expect(parseSlash('/status')).toEqual({ name: 'status', args: [], raw: '/status' });
  });
  it('returns null for non-commands', () => {
    expect(parseSlash('hello world')).toBeNull();
    expect(parseSlash('  not /a command')).toBeNull();
  });
});

describe('processInput (file/image tags)', () => {
  it('replaces a unix path with a clean file tag', () => {
    const r = processInput('look at ./src/index.ts please');
    expect(r.text).toBe('look at [arquivo: ./src/index.ts] please');
    expect(r.attachments).toEqual([{ kind: 'file', path: './src/index.ts' }]);
  });

  it('classifies image extensions as images (even without a separator)', () => {
    const r = processInput('check foto.PNG');
    expect(r.text).toBe('check [imagem: foto.PNG]');
    expect(r.attachments[0].kind).toBe('image');
  });

  it('handles quoted paths with spaces (drag-drop)', () => {
    const r = processInput('analyze "C:\\Users\\me\\My Photos\\foto.png"');
    expect(r.attachments).toEqual([{ kind: 'image', path: 'C:\\Users\\me\\My Photos\\foto.png' }]);
    expect(r.text).toContain('[imagem: C:\\Users\\me\\My Photos\\foto.png]');
  });

  it('does not misdetect prose words like node.js', () => {
    const r = processInput('I love node.js a lot');
    expect(r.attachments).toEqual([]);
    expect(r.text).toBe('I love node.js a lot');
  });
});

describe('UsageCounter', () => {
  it('accumulates and formats token usage', () => {
    const c = new UsageCounter();
    c.addInput(100);
    c.addOutput(50);
    c.addInput(20);
    expect(c.usage).toEqual({ input: 120, output: 50 });
    expect(c.format()).toBe('Tokens consumidos: Input: 120 | Output: 50');
    expect(formatUsage({ input: 1, output: 2 })).toBe('Tokens consumidos: Input: 1 | Output: 2');
  });
});
