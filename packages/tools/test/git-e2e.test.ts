/**
 * git/ — Teste ponta-a-ponta REAL do caminho de produção: Kernel cunha o token
 * a partir das capabilities DECLARADAS pela tool (`deriveCaps`), o Executor
 * aplica o gate e o Sandbox Tier 3 executa `git`. Nenhum token é forjado à mão
 * aqui — é exatamente o fluxo que roda no REPL.
 *
 * Fecha a lacuna que os testes de handler direto (`git-tools.test.ts`) não
 * cobrem: se `requestToCapability({proc.exec, scopeHint:'git'})` não produzir
 * `argv0Allow:['git']`, este teste falha (o de handler direto não falharia).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PlanIR } from '@clover/contracts';
import { createKernel, demoTools } from '@clover/kernel';

import { cloverTools } from '../src/index.js';

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_GIT = gitAvailable();

describe.skipIf(!HAS_GIT)('git/ e2e (Planner→Kernel→Sandbox, token cunhado)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'clover-git-e2e-'));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('-c', 'init.defaultBranch=main', 'init');
    git('config', 'user.email', 'test@clover.dev');
    git('config', 'user.name', 'Clover Test');
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    git('add', 'a.txt');
    git('commit', '-m', 'inicial');
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('submitPlan(git_status) executa com o token que o próprio Kernel cunha', async () => {
    const kernel = createKernel([...demoTools, ...cloverTools]);
    const plan: PlanIR = {
      version: '1',
      goalId: 'g-e2e',
      nodes: [{ kind: 'tool_call', id: 'n1', tool: 'git_status', args: {} }],
      edges: [],
      outputs: [{ kind: 'ref', nodeId: 'n1' }],
    };

    const res = await kernel.submitPlan(plan, { workspacePath: dir });

    // Se o token cunhado não autorizasse `git`, o status seria 'failed'
    // (capability_denied) e o output não teria branch.
    expect(res.fault).toBeUndefined();
    expect(res.status).toBe('done');
    const out = res.outputs[0] as { branch?: string; clean: boolean };
    expect(out.branch).toBe('main');
    expect(out.clean).toBe(true);
  });
});
