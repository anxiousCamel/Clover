/**
 * Namespace `dev/` — Build & QA (Fatia Arsenal #3).
 *
 * `run_build_and_test`: detecta o gerenciador de pacotes pelo arquivo de lock
 * e executa build e/ou testes via Sandbox Tier 3. Intent `read` — não modifica
 * artefatos de código; passa pelo Governor sem aprovação, inclusive no loop de
 * auto-cura do Agente.
 *
 * Saída estruturada: `success=false + stderr` é o sinal de falha que o Agente
 * lê para re-planejar com o erro como contexto.
 *
 * Engines suportadas: pnpm · npm · yarn · cargo.
 * Detecção por arquivo de lock (pnpm-lock.yaml / yarn.lock / package-lock.json /
 * Cargo.toml). Fallback: npm (se package.json presente) → pnpm.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { CapabilityRequest } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';
import { z } from 'zod';

import { defineZodTool } from '../abi.js';
import { runBinary } from '../sys/exec.js';

type PmEngine = 'pnpm' | 'npm' | 'yarn' | 'cargo';

/**
 * Menor privilégio: cada entrada cobre exatamente um argv[0].
 * Múltiplas entradas proc.exec → o Sandbox autoriza qualquer uma delas.
 */
const BUILD_CAPS: CapabilityRequest[] = [
  { kind: 'proc.exec', scopeHint: 'pnpm' },
  { kind: 'proc.exec', scopeHint: 'npm' },
  { kind: 'proc.exec', scopeHint: 'yarn' },
  { kind: 'proc.exec', scopeHint: 'cargo' },
];

/** Detecta o engine pelo arquivo de lock mais próximo da raiz do workspace. */
export function detectBuildEngine(workspacePath: string): PmEngine {
  if (existsSync(join(workspacePath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(workspacePath, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(workspacePath, 'package-lock.json'))) return 'npm';
  if (existsSync(join(workspacePath, 'Cargo.toml'))) return 'cargo';
  if (existsSync(join(workspacePath, 'package.json'))) return 'npm';
  return 'pnpm';
}

type Step = 'build' | 'test' | 'both';

/** Retorna a sequência de comandos para o engine e etapa. */
export function getBuildCommands(engine: PmEngine, step: Step): string[][] {
  if (engine === 'cargo') {
    if (step === 'build') return [['cargo', 'build']];
    if (step === 'test') return [['cargo', 'test']];
    return [['cargo', 'build'], ['cargo', 'test']];
  }
  if (step === 'build') return [[engine, 'run', 'build']];
  if (step === 'test') return [[engine, 'run', 'test']];
  return [[engine, 'run', 'build'], [engine, 'run', 'test']];
}

export const runBuildAndTestTool: LocalTool = defineZodTool({
  name: 'run_build_and_test',
  description:
    'Detecta o gerenciador de pacotes (pnpm/npm/yarn/cargo) pelo arquivo de lock e executa ' +
    'build e/ou testes via Sandbox. Retorna success=false + stderr legível em caso de falha — ' +
    'esse erro alimenta o loop de auto-cura do Agente (re-planejamento com contexto de erro).',
  input: z
    .object({
      step: z
        .enum(['build', 'test', 'both'])
        .optional()
        .default('both')
        .describe('Etapa a executar (default: both — build primeiro, depois test).'),
      cwd: z
        .string()
        .optional()
        .describe('Subdiretório relativo ao workspace onde rodar (default: raiz).'),
      timeoutMs: z
        .number()
        .int()
        .min(1_000)
        .max(300_000)
        .optional()
        .describe('Timeout por comando em ms (default: 120 000).'),
    })
    .strict(),
  output: z.object({
    success: z.boolean(),
    engine: z.string(),
    step: z.string(),
    exitCode: z.number().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    truncated: z.boolean(),
    failedCommand: z.string().nullable(),
  }),
  capabilities: BUILD_CAPS,
  intent: 'read',
  pure: false,
  run: async (args, ctx) => {
    const cwd = args.cwd ? join(ctx.workspacePath, args.cwd) : ctx.workspacePath;
    const engine = detectBuildEngine(cwd);
    const step = args.step ?? 'both';
    const commands = getBuildCommands(engine, step);
    const timeout = args.timeoutMs ?? 120_000;

    let allStdout = '';
    let allStderr = '';
    let truncated = false;

    for (const argv of commands) {
      const [bin, ...rest] = argv;
      const r = await runBinary({
        bin: bin!,
        args: rest,
        ctx,
        cwd,
        timeoutMs: timeout,
        maxBuffer: 2 * 1024 * 1024,
      });
      allStdout += r.stdout;
      allStderr += r.stderr;
      truncated = truncated || r.truncated;

      if (!r.ok) {
        const stderr =
          allStderr ||
          (r.timedOut ? `timeout após ${timeout}ms` : `saiu com código ${r.exitCode}`);
        return {
          success: false,
          engine,
          step,
          exitCode: r.exitCode,
          stdout: allStdout,
          stderr,
          truncated,
          failedCommand: argv.join(' '),
        };
      }
    }

    return {
      success: true,
      engine,
      step,
      exitCode: 0,
      stdout: allStdout,
      stderr: allStderr,
      truncated,
      failedCommand: null,
    };
  },
});
