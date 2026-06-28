/**
 * Capability tokens — menor privilégio, assinatura (detecção de adulteração) e
 * expiração (RAP §10). Prova que ampliar `caps` invalida o token.
 */

import { describe, expect, it } from 'vitest';

import type { PlanIR, ToolDescriptor } from '@clover/contracts';
import { CapabilityResolver, deriveCaps } from '@clover/capability';

const plan: PlanIR = {
  version: '1',
  goalId: 'g',
  nodes: [
    { kind: 'tool_call', id: 'n1', tool: 'echo', args: { text: 'hi' } },
    { kind: 'tool_call', id: 'n2', tool: 'read', args: {} },
  ],
  edges: [],
  outputs: [{ kind: 'ref', nodeId: 'n2' }],
};

const tools: ToolDescriptor[] = [
  { name: 'echo', description: '', inputSchema: {}, capabilities: [], origin: 'local' },
  {
    name: 'read',
    description: '',
    inputSchema: {},
    capabilities: [{ kind: 'fs.read', scopeHint: '/ws/**' }],
    origin: 'local',
  },
];

describe('capability resolver', () => {
  it('derives least-privilege caps (only referenced tools + their resource caps)', () => {
    const caps = deriveCaps(plan, tools);
    expect(caps).toContainEqual({ kind: 'tool', name: 'echo' });
    expect(caps).toContainEqual({ kind: 'tool', name: 'read' });
    expect(caps).toContainEqual({ kind: 'fs.read', pathGlob: '/ws/**' });
    // Nada além disso (sem fs.write, sem net).
    expect(caps.some((c) => c.kind === 'fs.write' || c.kind === 'net')).toBe(false);
  });

  it('verifies a freshly minted token', () => {
    const r = new CapabilityResolver('s1');
    const token = r.mint(plan, 'task1', { tools });
    expect(r.verify(token)).toBe(true);
  });

  it('rejects a tampered token (caps widened after signing)', () => {
    const r = new CapabilityResolver('s1');
    const token = r.mint(plan, 'task1', { tools });
    const tampered = { ...token, caps: [...token.caps, { kind: 'fs.write', pathGlob: '/etc/**' } as const] };
    expect(r.verify(tampered)).toBe(false);
  });

  it('rejects an expired token', () => {
    const r = new CapabilityResolver('s1');
    const token = r.mint(plan, 'task1', { tools, now: 0, ttlMs: 1000 });
    expect(r.verify(token, { now: 500 })).toBe(true);
    expect(r.verify(token, { now: 2000 })).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const issuer = new CapabilityResolver('s1');
    const attacker = new CapabilityResolver('s2');
    const token = issuer.mint(plan, 'task1', { tools });
    expect(attacker.verify(token)).toBe(false);
  });

  it('authorizes only granted capabilities', () => {
    const r = new CapabilityResolver('s1');
    const token = r.mint(plan, 'task1', { tools });
    expect(r.authorize(token, { kind: 'tool', scopeHint: 'echo' })).toBe(true);
    expect(r.authorize(token, { kind: 'tool', scopeHint: 'delete' })).toBe(false);
    expect(r.authorize(token, { kind: 'fs.read' })).toBe(true);
    expect(r.authorize(token, { kind: 'fs.write' })).toBe(false);
  });
});
