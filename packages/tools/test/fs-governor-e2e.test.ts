/**
 * fs/ + Governor — e2e: prova que o Executor intercepta write_file/patch_file.
 *
 * Fluxo: createKernel (authorize hook opcional) → submitPlan → Executor gate →
 * Governor.authorize() → sys/fs (node:fs direto — sem Sandbox). O teste valida
 * que NENHUMA tool de escrita roda sem autorização, e que o Governor auto/step
 * decide corretamente.
 *
 * Nota de design: write_file/patch_file usam sys/fs (node:fs), NÃO o Sandbox
 * Tier 3. O chokepoint correto é o Executor (ele vê `intent`); mover a trava
 * para o Sandbox deixaria as tools de fs desprotegidas.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PlanIR } from '@clover/contracts';
import { createKernel, demoTools } from '@clover/kernel';
import { ExecutionGovernor } from '@clover/resource-manager';

import { cloverTools } from '../src/index.js';

describe('fs/ Governor e2e (Executor intercepta write/patch)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'clover-fs-gov-'));
    writeFileSync(join(dir, 'seed.txt'), 'hello world\n', 'utf8');
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function writePlan(path = 'out.txt', content = 'clover\n'): PlanIR {
    return {
      version: '1',
      goalId: 'g-fs-write',
      nodes: [{ kind: 'tool_call', id: 'n1', tool: 'write_file', args: { path, content } }],
      edges: [],
      outputs: [{ kind: 'ref', nodeId: 'n1' }],
    };
  }

  // ---------------------------------------------------------------------------
  // Fail-safe: sem Governor → qualquer write é negado
  // ---------------------------------------------------------------------------

  it('write_file sem authorize hook → authorization_denied (fail-safe)', async () => {
    const kernel = createKernel([...demoTools, ...cloverTools]);
    const res = await kernel.submitPlan(writePlan('nosave.txt'), { workspacePath: dir });
    expect(res.status).toBe('failed');
    expect(res.fault?.code).toBe('authorization_denied');
    expect(existsSync(join(dir, 'nosave.txt'))).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Governor auto: permite + audita
  // ---------------------------------------------------------------------------

  it('write_file com Governor auto → done + arquivo criado', async () => {
    const gov = new ExecutionGovernor({ mode: 'auto' });
    const kernel = createKernel([...demoTools, ...cloverTools], {
      authorize: (req) => gov.authorize(req),
      guard: (fn) => gov.guard(fn),
    });
    const res = await kernel.submitPlan(writePlan('auto.txt', 'auto mode\n'), { workspacePath: dir });
    expect(res.status).toBe('done');
    expect(res.fault).toBeUndefined();
    const out = res.outputs[0] as { path: string; bytes: number };
    expect(out.path).toBe('auto.txt');
    expect(out.bytes).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'auto.txt'))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Governor step, prompt negado → denied + arquivo NÃO criado
  // ---------------------------------------------------------------------------

  it('write_file com Governor step, prompt negado → authorization_denied', async () => {
    const gov = new ExecutionGovernor({ mode: 'step', prompt: () => false });
    const kernel = createKernel([...demoTools, ...cloverTools], {
      authorize: (req) => gov.authorize(req),
    });
    const res = await kernel.submitPlan(writePlan('denied.txt'), { workspacePath: dir });
    expect(res.status).toBe('failed');
    expect(res.fault?.code).toBe('authorization_denied');
    expect(existsSync(join(dir, 'denied.txt'))).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Governor step, prompt aprovado → done
  // ---------------------------------------------------------------------------

  it('write_file com Governor step, prompt aprovado → done', async () => {
    const gov = new ExecutionGovernor({ mode: 'step', prompt: () => true });
    const kernel = createKernel([...demoTools, ...cloverTools], {
      authorize: (req) => gov.authorize(req),
      guard: (fn) => gov.guard(fn),
    });
    const res = await kernel.submitPlan(writePlan('step-ok.txt', 'step approved\n'), { workspacePath: dir });
    expect(res.status).toBe('done');
    expect(existsSync(join(dir, 'step-ok.txt'))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // patch_file: escrita cirúrgica também passa pelo Governor
  // ---------------------------------------------------------------------------

  it('patch_file sem Governor → authorization_denied', async () => {
    const kernel = createKernel([...demoTools, ...cloverTools]);
    const plan: PlanIR = {
      version: '1',
      goalId: 'g-patch',
      nodes: [{ kind: 'tool_call', id: 'n1', tool: 'patch_file', args: { path: 'seed.txt', search: 'hello', replace: 'HELLO' } }],
      edges: [],
      outputs: [{ kind: 'ref', nodeId: 'n1' }],
    };
    const res = await kernel.submitPlan(plan, { workspacePath: dir });
    expect(res.status).toBe('failed');
    expect(res.fault?.code).toBe('authorization_denied');
    // Arquivo original intacto.
    expect(readFileSync(join(dir, 'seed.txt'), 'utf8')).toBe('hello world\n');
  });

  it('patch_file com Governor auto → done + conteúdo atualizado', async () => {
    const gov = new ExecutionGovernor({ mode: 'auto' });
    const kernel = createKernel([...demoTools, ...cloverTools], { authorize: (req) => gov.authorize(req) });
    const plan: PlanIR = {
      version: '1',
      goalId: 'g-patch-auto',
      nodes: [{ kind: 'tool_call', id: 'n1', tool: 'patch_file', args: { path: 'seed.txt', search: 'hello', replace: 'HELLO' } }],
      edges: [],
      outputs: [{ kind: 'ref', nodeId: 'n1' }],
    };
    const res = await kernel.submitPlan(plan, { workspacePath: dir });
    expect(res.status).toBe('done');
    expect(readFileSync(join(dir, 'seed.txt'), 'utf8')).toBe('HELLO world\n');
  });

  // ---------------------------------------------------------------------------
  // read_file_paginated: intent=read → Governor NÃO é chamado
  // ---------------------------------------------------------------------------

  it('read_file_paginated (read intent) não passa pelo authorize', async () => {
    const authorized: string[] = [];
    const gov = new ExecutionGovernor({
      mode: 'auto',
      audit: (e) => { if (e.decision === 'allowed') authorized.push(e.tool); },
    });
    const kernel = createKernel([...demoTools, ...cloverTools], { authorize: (req) => gov.authorize(req) });
    const plan: PlanIR = {
      version: '1',
      goalId: 'g-read',
      nodes: [{ kind: 'tool_call', id: 'n1', tool: 'read_file_paginated', args: { path: 'seed.txt' } }],
      edges: [],
      outputs: [{ kind: 'ref', nodeId: 'n1' }],
    };
    const res = await kernel.submitPlan(plan, { workspacePath: dir });
    expect(res.status).toBe('done');
    // read não entra no authorize → não aparece no audit
    expect(authorized).not.toContain('read_file_paginated');
  });
});
