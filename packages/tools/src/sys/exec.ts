/**
 * sys/exec — Primitiva única de execução de binário externo.
 *
 * TODA tool que precisa rodar um processo passa por aqui, e `runBinary` delega
 * ao **Sandbox Tier 3** (`@clover/sandbox`): argv como array (sem shell, sem
 * injeção), fronteira de workspace canônica, gate de capability `proc.exec`
 * (argv[0] na allowlist do token) e timeout + SIGKILL. Nenhuma tool importa
 * `node:child_process` — essa é a regra de segurança do mandato.
 *
 * Contrato adicional sobre o Sandbox:
 *   - `truncated`: o Sandbox para de acumular stdout ao atingir `maxBuffer` sem
 *     sinalizar. Aqui levantamos a flag para o chamador (parsers de `git log`/
 *     `git diff` precisam saber que a saída pode estar incompleta).
 *   - `detectBinary`: detecção + versão do binário (graceful degradation — uma
 *     tool informa "binário ausente" em vez de quebrar o REPL).
 */

import type { ToolInvocation } from '@clover/contracts';
import { ProcessSandbox, type SandboxBackend } from '@clover/sandbox';

import { baseDir } from './fs.js';

/** 1 MiB — mesmo default do Sandbox; suba para saídas grandes (diff/log). */
const DEFAULT_MAX_BUFFER = 1024 * 1024;

export interface RunBinaryOptions {
  /** argv[0]: o programa. Precisa estar autorizado no token (`proc.exec`). */
  bin: string;
  /** Argumentos (NUNCA passados por shell). */
  args: string[];
  /** Contexto da invocação — fonte do token e do workspacePath. */
  ctx: ToolInvocation;
  /** Timeout de parede (ms). Default: o do Sandbox (10s). */
  timeoutMs?: number;
  /** stdin opcional. */
  input?: string;
  /** Bytes máximos por stream. Default 1 MiB. */
  maxBuffer?: number;
  /** Subdiretório de trabalho (absoluto, dentro do workspace). Default: workspace. */
  cwd?: string;
  /** Backend alternativo (testes). Default: instância compartilhada. */
  sandbox?: SandboxBackend;
}

export interface RunBinaryResult {
  /** `exitCode === 0 && !timedOut`. */
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** stdout atingiu `maxBuffer` — a saída pode estar incompleta. */
  truncated: boolean;
}

const sharedSandbox = new ProcessSandbox();

/** Executa um binário pelo Sandbox Tier 3 e normaliza o resultado. */
export async function runBinary(opts: RunBinaryOptions): Promise<RunBinaryResult> {
  const sandbox = opts.sandbox ?? sharedSandbox;
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  // Default = cwd de sessão (roaming global), senão o workspace da invocação.
  const cwd = opts.cwd ?? baseDir(opts.ctx);

  const res = await sandbox.run({
    argv: [opts.bin, ...opts.args],
    cwd,
    workspacePath: opts.ctx.workspacePath,
    token: opts.ctx.token,
    timeoutMs: opts.timeoutMs,
    input: opts.input,
    maxBuffer,
  });

  return {
    ok: res.exitCode === 0 && !res.timedOut,
    exitCode: res.exitCode,
    stdout: res.stdout,
    stderr: res.stderr,
    timedOut: res.timedOut,
    // O Sandbox para de acumular em `length >= maxBuffer`; tratamos como truncado.
    truncated: res.stdout.length >= maxBuffer,
  };
}

export interface BinaryInfo {
  available: boolean;
  /** Primeira sequência tipo `1.2.3` encontrada na saída de `--version`. */
  version?: string;
  /** Linha de versão crua (para diagnóstico). */
  raw?: string;
}

/**
 * Detecta a presença e a versão de um binário. Graceful: capability negada,
 * binário ausente ou timeout retornam `{ available: false }` em vez de lançar.
 */
export async function detectBinary(
  ctx: ToolInvocation,
  bin: string,
  versionArgs: string[] = ['--version'],
): Promise<BinaryInfo> {
  try {
    const r = await runBinary({
      bin,
      args: versionArgs,
      ctx,
      timeoutMs: 5_000,
      maxBuffer: 64 * 1024,
    });
    if (!r.ok) return { available: false };
    const raw = (r.stdout || r.stderr).trim();
    const version = raw.match(/\d+\.\d+(?:\.\d+)?/)?.[0];
    return { available: true, version, raw };
  } catch {
    // SandboxViolation (não autorizado) ou erro de spawn → indisponível.
    return { available: false };
  }
}
