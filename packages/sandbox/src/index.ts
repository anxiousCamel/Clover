/**
 * @clover/sandbox — Backends de isolamento (RAP §5.2, §11.13; corrige P3).
 *
 * Fatia 6 entrega o **Tier 3 (processo endurecido)** usando `node:child_process`
 * (built-in, sem dependência nativa):
 *   - **sem shell** (argv como array) → elimina shell injection;
 *   - **fronteira de workspace** por path canônico → bloqueia escape por `..`
 *     e por caminho absoluto;
 *   - **timeout + SIGKILL**;
 *   - **ambiente mínimo** (não herda o env do processo);
 *   - **gate de capability** `proc.exec` (argv[0] precisa estar na allowlist).
 *
 * Tiers 1 (`isolated-vm`) e 2 (WASM/`wasmtime`) entram depois — exigem build
 * nativo (ver PROGRESS.md). Limites finos de CPU/RAM dependem desses tiers
 * (cgroups/fuel); o Tier 3 entrega timeout de parede + isolamento de processo.
 */

import { spawn } from 'node:child_process';
import { resolve, sep } from 'node:path';

import type { CapabilityToken } from '@clover/contracts';

export class SandboxViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxViolation';
  }
}

export interface SandboxResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ProcessRunRequest {
  /** argv[0] = programa; resto = argumentos. NUNCA passado por um shell. */
  argv: string[];
  /** Diretório de trabalho — precisa estar dentro de `workspacePath`. */
  cwd: string;
  workspacePath: string;
  /** Token que deve conceder `proc.exec` para argv[0]. */
  token: CapabilityToken;
  timeoutMs?: number;
  /** Ambiente explícito (default: mínimo — só PATH, para resolver binários). */
  env?: Record<string, string>;
  /** stdin opcional. */
  input?: string;
  /** Bytes máximos capturados por stream (default 1 MiB) — evita OOM por saída. */
  maxBuffer?: number;
}

export interface SandboxBackend {
  readonly kind: 'process' | 'isolated-vm' | 'wasm';
  run(req: ProcessRunRequest): Promise<SandboxResult>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFER = 1024 * 1024;

/** Tier 3 — processo isolado e endurecido. */
export class ProcessSandbox implements SandboxBackend {
  readonly kind = 'process' as const;

  constructor(private readonly defaultTimeoutMs = DEFAULT_TIMEOUT_MS) {}

  async run(req: ProcessRunRequest): Promise<SandboxResult> {
    const program = req.argv[0];
    if (!program) throw new SandboxViolation('argv vazio');

    // 1) Gate de capability: proc.exec deve permitir o programa.
    const allowed = req.token.caps.some(
      (c) => c.kind === 'proc.exec' && (c.argv0Allow.includes(program) || c.argv0Allow.includes('*')),
    );
    if (!allowed) {
      throw new SandboxViolation(`proc.exec não autorizado para '${program}'`);
    }

    // 2) Fronteira de workspace (canônica) — bloqueia escape por `..`/absoluto.
    const ws = resolve(req.workspacePath);
    const cwd = resolve(req.cwd);
    if (cwd !== ws && !cwd.startsWith(ws + sep)) {
      throw new SandboxViolation(`cwd fora do workspace: ${cwd}`);
    }

    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    const maxBuffer = req.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const env = req.env ?? { PATH: process.env.PATH ?? '' };

    // 3) spawn SEM shell (argv array) → sem interpretação/injeção.
    return await new Promise<SandboxResult>((resolveP) => {
      const child = spawn(program, req.argv.slice(1), {
        cwd,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const finish = (result: SandboxResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveP(result);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.on('data', (d: Buffer) => {
        if (stdout.length < maxBuffer) stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        if (stderr.length < maxBuffer) stderr += d.toString();
      });
      child.on('error', (e) => finish({ exitCode: null, stdout, stderr: stderr + String(e), timedOut }));
      child.on('close', (code) => finish({ exitCode: code, stdout, stderr, timedOut }));

      if (req.input) child.stdin.end(req.input);
      else child.stdin.end();
    });
  }
}
