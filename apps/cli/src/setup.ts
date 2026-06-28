/**
 * Setup idempotente do CloverOS (Escopo 3.1).
 *
 * Faz sanity check completo e executa **apenas** o que falta. A lógica é pura e
 * testável via `SetupProbes` injetáveis; o glue (child_process/fetch/fs) vive no
 * `probes` real montado em `main.ts`.
 */

import type { ThemeManager } from '@clover/tui';

export type StepStatus = 'ok' | 'fixed' | 'skip' | 'warn' | 'fail';

export interface SetupStep {
  name: string;
  status: StepStatus;
  detail?: string;
}

export interface SetupProbes {
  nodeVersion(): string | null;
  pnpmAvailable(): Promise<boolean>;
  nodeModulesExists(): boolean;
  buildExists(): boolean;
  installDeps(): Promise<void>;
  buildTs(): Promise<void>;
  ollamaRunning(): Promise<boolean>;
  startOllama(): Promise<boolean>;
  modelPresent(model: string): Promise<boolean>;
  pullModel(model: string): Promise<void>;
}

export interface SetupOptions {
  model: string;
  /** Apenas diagnostica; não executa correções. */
  checkOnly?: boolean;
}

export async function runSetup(probes: SetupProbes, opts: SetupOptions): Promise<SetupStep[]> {
  const steps: SetupStep[] = [];

  const node = probes.nodeVersion();
  if (!node) {
    steps.push({ name: 'Node.js', status: 'fail', detail: 'Node não encontrado no PATH' });
    return steps;
  }
  steps.push({ name: 'Node.js', status: 'ok', detail: node });

  if (!(await probes.pnpmAvailable())) {
    steps.push({ name: 'pnpm', status: 'fail', detail: 'instale com: npm i -g pnpm' });
    return steps;
  }
  steps.push({ name: 'pnpm', status: 'ok' });

  // Dependências — pula se já existir.
  if (probes.nodeModulesExists()) {
    steps.push({ name: 'Dependências', status: 'skip', detail: 'node_modules já existe' });
  } else if (opts.checkOnly) {
    steps.push({ name: 'Dependências', status: 'warn', detail: 'faltando — rode `clover setup`' });
  } else {
    await probes.installDeps();
    steps.push({ name: 'Dependências', status: 'fixed', detail: 'pnpm install' });
  }

  // Build TS — pula se dist já existir.
  if (probes.buildExists()) {
    steps.push({ name: 'Build TS', status: 'skip', detail: 'dist atualizado' });
  } else if (opts.checkOnly) {
    steps.push({ name: 'Build TS', status: 'warn', detail: 'faltando' });
  } else {
    await probes.buildTs();
    steps.push({ name: 'Build TS', status: 'fixed', detail: 'tsc --build' });
  }

  // Ollama — tenta iniciar se não estiver rodando.
  let ollama = await probes.ollamaRunning();
  if (!ollama && !opts.checkOnly) ollama = await probes.startOllama();
  steps.push(
    ollama
      ? { name: 'Ollama', status: 'ok' }
      : { name: 'Ollama', status: 'warn', detail: 'não está rodando — `ollama serve`' },
  );

  // Modelo padrão — pull se faltar.
  if (ollama) {
    if (await probes.modelPresent(opts.model)) {
      steps.push({ name: `Modelo ${opts.model}`, status: 'skip', detail: 'já baixado' });
    } else if (opts.checkOnly) {
      steps.push({ name: `Modelo ${opts.model}`, status: 'warn', detail: 'não baixado' });
    } else {
      await probes.pullModel(opts.model);
      steps.push({ name: `Modelo ${opts.model}`, status: 'fixed', detail: 'pull concluído' });
    }
  }

  return steps;
}

export function renderSteps(steps: SetupStep[], theme: ThemeManager): string {
  const icon = (s: StepStatus): string => {
    if (s === 'ok' || s === 'fixed' || s === 'skip') return theme.statusIcon('ok');
    if (s === 'warn') return theme.warn(theme.symbols.pending);
    return theme.statusIcon('fail');
  };
  const lines = steps.map((s) => {
    const tail = s.detail ? theme.dim(` (${s.detail})`) : '';
    const tag = theme.dim(`[${s.status}]`);
    return `${icon(s.status)} ${s.name} ${tag}${tail}`;
  });
  return [theme.banner('CloverOS setup'), ...lines].join('\n');
}
