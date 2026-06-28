import { describe, expect, it } from 'vitest';

import { runSetup, type SetupProbes } from '../src/setup.js';

interface Calls {
  install: number;
  build: number;
  start: number;
  pull: number;
}

function probes(over: Partial<SetupProbes>, calls: Calls): SetupProbes {
  return {
    nodeVersion: () => 'v22.0.0',
    pnpmAvailable: async () => true,
    nodeModulesExists: () => true,
    buildExists: () => true,
    ollamaRunning: async () => true,
    startOllama: async () => {
      calls.start++;
      return true;
    },
    modelPresent: async () => true,
    installDeps: async () => {
      calls.install++;
    },
    buildTs: async () => {
      calls.build++;
    },
    pullModel: async () => {
      calls.pull++;
    },
    ...over,
  };
}

function byName(steps: { name: string; status: string }[], name: string): string {
  return steps.find((s) => s.name.startsWith(name))?.status ?? 'missing';
}

describe('runSetup (idempotent)', () => {
  it('skips everything that is already present (no actions)', async () => {
    const calls: Calls = { install: 0, build: 0, start: 0, pull: 0 };
    const steps = await runSetup(probes({}, calls), { model: 'qwen2.5-coder' });
    expect(byName(steps, 'Node')).toBe('ok');
    expect(byName(steps, 'Dependências')).toBe('skip');
    expect(byName(steps, 'Build')).toBe('skip');
    expect(byName(steps, 'Ollama')).toBe('ok');
    expect(byName(steps, 'Modelo')).toBe('skip');
    expect(calls).toEqual({ install: 0, build: 0, start: 0, pull: 0 });
  });

  it('fixes only what is missing', async () => {
    const calls: Calls = { install: 0, build: 0, start: 0, pull: 0 };
    const steps = await runSetup(
      probes(
        {
          nodeModulesExists: () => false,
          buildExists: () => false,
          ollamaRunning: async () => false,
          modelPresent: async () => false,
        },
        calls,
      ),
      { model: 'qwen2.5-coder' },
    );
    expect(byName(steps, 'Dependências')).toBe('fixed');
    expect(byName(steps, 'Build')).toBe('fixed');
    expect(byName(steps, 'Modelo')).toBe('fixed');
    expect(calls).toEqual({ install: 1, build: 1, start: 1, pull: 1 });
  });

  it('checkOnly diagnoses without performing actions', async () => {
    const calls: Calls = { install: 0, build: 0, start: 0, pull: 0 };
    const steps = await runSetup(
      probes({ nodeModulesExists: () => false, buildExists: () => false }, calls),
      { model: 'qwen2.5-coder', checkOnly: true },
    );
    expect(byName(steps, 'Dependências')).toBe('warn');
    expect(byName(steps, 'Build')).toBe('warn');
    expect(calls).toEqual({ install: 0, build: 0, start: 0, pull: 0 });
  });

  it('fails fast when Node is missing', async () => {
    const calls: Calls = { install: 0, build: 0, start: 0, pull: 0 };
    const steps = await runSetup(probes({ nodeVersion: () => null }, calls), { model: 'm' });
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe('fail');
  });
});
