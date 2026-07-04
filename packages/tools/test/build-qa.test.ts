/**
 * dev/ build — Testes do `run_build_and_test`.
 *
 * Dois níveis de teste:
 *   1. Unitário: `detectBuildEngine` e `getBuildCommands` (funções puras).
 *   2. Integração handler: executa comandos reais via Sandbox; usa `node` como
 *      "engine" via package.json com scripts que chamam node diretamente, para
 *      garantir portabilidade (node é um binário nativo em todas as plataformas).
 *
 * A suíte de integração é pulada se o `npm` não estiver disponível como binário
 * spawnable sem shell (detectado via `execFileSync`).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CapabilityToken, ToolInvocation } from '@clover/contracts';

import { detectBuildEngine, getBuildCommands, runBuildAndTestTool } from '../src/dev/build.js';

// ---------------------------------------------------------------------------
// Testes unitários (funções puras — sem sandbox, sem FS real)
// ---------------------------------------------------------------------------

describe('detectBuildEngine (unitário)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'clover-detect-'));
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('detecta pnpm quando pnpm-lock.yaml existe', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    expect(detectBuildEngine(dir)).toBe('pnpm');
  });

  it('detecta npm quando package-lock.json existe (sem pnpm-lock)', () => {
    rmSync(join(dir, 'pnpm-lock.yaml'));
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    expect(detectBuildEngine(dir)).toBe('npm');
  });

  it('detecta yarn quando yarn.lock existe', () => {
    rmSync(join(dir, 'package-lock.json'));
    writeFileSync(join(dir, 'yarn.lock'), '');
    expect(detectBuildEngine(dir)).toBe('yarn');
  });

  it('detecta cargo quando Cargo.toml existe', () => {
    rmSync(join(dir, 'yarn.lock'));
    writeFileSync(join(dir, 'Cargo.toml'), '[package]');
    expect(detectBuildEngine(dir)).toBe('cargo');
  });

  it('cai em npm quando só package.json existe', () => {
    rmSync(join(dir, 'Cargo.toml'));
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(detectBuildEngine(dir)).toBe('npm');
  });
});

describe('getBuildCommands (unitário)', () => {
  it('pnpm build → um comando', () => {
    expect(getBuildCommands('pnpm', 'build')).toEqual([['pnpm', 'run', 'build']]);
  });

  it('pnpm test → um comando', () => {
    expect(getBuildCommands('pnpm', 'test')).toEqual([['pnpm', 'run', 'test']]);
  });

  it('npm both → dois comandos em sequência', () => {
    expect(getBuildCommands('npm', 'both')).toEqual([
      ['npm', 'run', 'build'],
      ['npm', 'run', 'test'],
    ]);
  });

  it('cargo both → dois comandos em sequência', () => {
    expect(getBuildCommands('cargo', 'both')).toEqual([
      ['cargo', 'build'],
      ['cargo', 'test'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Testes de integração: handler real via Sandbox (requer npm spawnable)
// ---------------------------------------------------------------------------

function npmAvailable(): boolean {
  try {
    execFileSync('npm', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_NPM = npmAvailable();

describe.skipIf(!HAS_NPM)(
  'run_build_and_test handler (integração — npm via Sandbox)',
  () => {
    let dir: string;

    function ctx(workspacePath = dir): ToolInvocation {
      return {
        taskId: 'test-build',
        traceId: 'test-trace',
        workspacePath,
        token: {
          id: 'build-token',
          taskId: 'test-build',
          // npm precisa de proc.exec autorizado.
          caps: [{ kind: 'proc.exec', argv0Allow: ['npm'], maxProcs: 2 }],
          issuedAt: Date.now(),
          expiresAt: Date.now() + 120_000,
          sig: 'test',
        } satisfies CapabilityToken,
        emit: () => {},
      };
    }

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'clover-build-'));
      // package-lock.json faz detectBuildEngine retornar 'npm'.
      writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }));
    });

    afterAll(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('test script com exit 1 → success=false, stderr legível', async () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          scripts: { test: 'node -e "process.stderr.write(\'erro de build\\n\'); process.exit(1)"' },
        }),
      );

      const res = await runBuildAndTestTool.handler({ step: 'test' }, ctx());
      expect(res.success).toBe(true); // ToolResult.success (handler não lançou)
      const r = res.output as {
        success: boolean;
        stderr: string;
        exitCode: number | null;
        engine: string;
        failedCommand: string | null;
      };

      expect(r.success).toBe(false); // build falhou
      expect(r.engine).toBe('npm');
      expect(r.exitCode).toBe(1);
      // Stderr deve ser legível (não vazio, não binário).
      expect(typeof r.stderr).toBe('string');
      expect(r.stderr.length).toBeGreaterThan(0);
      expect(r.failedCommand).toBe('npm run test');
    });

    it('test script com exit 0 → success=true', async () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          scripts: { test: 'node -e "process.exit(0)"' },
        }),
      );

      const res = await runBuildAndTestTool.handler({ step: 'test' }, ctx());
      expect(res.success).toBe(true);
      const out = res.output as { success: boolean; exitCode: number | null };
      expect(out.success).toBe(true);
      expect(out.exitCode).toBe(0);
    });

    it('step=build com script de build que passa → success=true', async () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          scripts: { build: 'node -e "process.exit(0)"' },
        }),
      );

      const res = await runBuildAndTestTool.handler({ step: 'build' }, ctx());
      expect(res.success).toBe(true);
      const out = res.output as { success: boolean };
      expect(out.success).toBe(true);
    });

    it('para no primeiro comando que falha (build ok, test falha → failedCommand = test)', async () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          scripts: {
            build: 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(2)"',
          },
        }),
      );

      const res = await runBuildAndTestTool.handler({ step: 'both' }, ctx());
      expect(res.success).toBe(true);
      const out = res.output as { success: boolean; failedCommand: string | null };
      expect(out.success).toBe(false);
      expect(out.failedCommand).toBe('npm run test');
    });
  },
);
