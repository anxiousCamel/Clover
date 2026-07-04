/**
 * Namespace `git/` — Departamento Git (leitura + escrita).
 *
 * Toda tool: schema Zod (in/out), capability `proc.exec` para `git`, execução
 * via `runBinary` → Sandbox Tier 3. As tools NÃO são `pure` (dependem do estado
 * da árvore de trabalho/refs).
 *
 * Fatia Arsenal #3 adiciona as operações de escrita:
 *   git_commit, git_checkout_branch, git_restore (destructive), git_revert.
 * Todas exigem authorização do Governor (intent write/destructive).
 *
 * Segurança: o Sandbox só checa argv[0] (`git`); os demais argumentos passam
 * livres. Por isso refs/pathspecs do usuário são validadas (`assertSafeRef`) e
 * todo pathspec vai depois de `--` para impedir injeção de opção.
 */

import { join } from 'node:path';

import type { CapabilityRequest, ToolInvocation } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';
import { z } from 'zod';

import { defineZodTool } from '../abi.js';
import { runBinary, type RunBinaryResult } from '../sys/exec.js';
import {
  parseBlamePorcelain,
  parseBranchList,
  parseDiffNameStatus,
  parseLog,
  parseStatusPorcelainV2,
} from './parse.js';

/** Unit separator usado nos formatos de `git log`. */
const US = '\x1f';
/** Saídas grandes (log/diff/blame/show): 8 MiB antes de truncar. */
const BIG_BUFFER = 8 * 1024 * 1024;

/** Capability mínima de todas as tools git: executar o binário `git`. */
const GIT_EXEC: CapabilityRequest[] = [{ kind: 'proc.exec', scopeHint: 'git' }];

/** Flags base: sem cor e sem aspas de path (saída estável p/ parsing). */
const BASE = ['-c', 'core.quotepath=false', '-c', 'color.ui=false'];

/** Resolve um cwd relativo dentro do workspace (o Sandbox barra escapes). */
function resolveCwd(ctx: ToolInvocation, rel?: string): string | undefined {
  return rel ? join(ctx.workspacePath, rel) : undefined;
}

/** Rejeita refs/pathspecs que o git interpretaria como flag (injeção de opção). */
function assertSafeRef(ref: string, label = 'ref'): void {
  if (ref.startsWith('-')) throw new Error(`${label} inválida (não pode começar com '-'): ${ref}`);
}

/** Mensagem de erro de uma execução git que falhou. */
function gitError(r: RunBinaryResult): string {
  if (r.timedOut) return 'git: timeout excedido';
  const line = (r.stderr || r.stdout).trim().split('\n')[0];
  return `git: ${line || `saiu com código ${r.exitCode}`}`;
}

/** Executa `git <args>` e devolve o resultado bruto (ou lança erro estruturado). */
async function runGit(
  ctx: ToolInvocation,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; maxBuffer?: number } = {},
): Promise<RunBinaryResult> {
  const r = await runBinary({
    bin: 'git',
    args: [...BASE, ...args],
    ctx,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 15_000,
    maxBuffer: opts.maxBuffer,
  });
  if (!r.ok) throw new Error(gitError(r));
  return r;
}

const CwdInput = z.string().optional().describe('Subdiretório relativo ao workspace (opcional).');

// ===========================================================================
// git_status
// ===========================================================================

const GitFileStatusSchema = z.object({
  path: z.string(),
  origPath: z.string().optional(),
  index: z.string(),
  worktree: z.string(),
});

export const gitStatusTool: LocalTool = defineZodTool({
  name: 'git_status',
  description:
    'Status estruturado do repositório Git: branch, ahead/behind do upstream e arquivos modificados (staged/unstaged/untracked).',
  input: z.object({ cwd: CwdInput }).strict(),
  output: z.object({
    branch: z.string().optional(),
    oid: z.string().optional(),
    upstream: z.string().optional(),
    ahead: z.number(),
    behind: z.number(),
    files: z.array(GitFileStatusSchema),
    clean: z.boolean(),
    truncated: z.boolean(),
  }),
  capabilities: GIT_EXEC,
  pure: false,
  run: async (args, ctx) => {
    const r = await runGit(ctx, ['status', '--porcelain=v2', '--branch', '-z'], {
      cwd: resolveCwd(ctx, args.cwd),
    });
    return { ...parseStatusPorcelainV2(r.stdout), truncated: r.truncated };
  },
});

// ===========================================================================
// git_current_branch
// ===========================================================================

export const gitCurrentBranchTool: LocalTool = defineZodTool({
  name: 'git_current_branch',
  description: 'Nome da branch atual (ou "HEAD" se em estado detached).',
  input: z.object({ cwd: CwdInput }).strict(),
  output: z.object({ branch: z.string(), detached: z.boolean() }),
  capabilities: GIT_EXEC,
  pure: false,
  run: async (args, ctx) => {
    const r = await runGit(ctx, ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: resolveCwd(ctx, args.cwd),
    });
    const branch = r.stdout.trim();
    return { branch, detached: branch === 'HEAD' };
  },
});

// ===========================================================================
// git_log
// ===========================================================================

export const gitLogTool: LocalTool = defineZodTool({
  name: 'git_log',
  description:
    'Histórico de commits estruturado (hash, autor, email, data ISO, assunto). Limite obrigatório por maxCount; filtro opcional por path.',
  input: z
    .object({
      maxCount: z.number().int().min(1).max(1000).optional().describe('Máx. de commits (default 50).'),
      path: z.string().optional().describe('Limita o histórico a um caminho.'),
      cwd: CwdInput,
    })
    .strict(),
  output: z.object({
    commits: z.array(
      z.object({
        hash: z.string(),
        author: z.string(),
        email: z.string(),
        date: z.string(),
        subject: z.string(),
      }),
    ),
    truncated: z.boolean(),
  }),
  capabilities: GIT_EXEC,
  pure: false,
  run: async (args, ctx) => {
    const fmt = `--pretty=format:%H${US}%an${US}%aE${US}%aI${US}%s`;
    const argv = ['log', '-z', fmt, '-n', String(args.maxCount ?? 50)];
    if (args.path) argv.push('--', args.path); // pathspec após `--`
    const r = await runGit(ctx, argv, { cwd: resolveCwd(ctx, args.cwd), maxBuffer: BIG_BUFFER });
    return { commits: parseLog(r.stdout), truncated: r.truncated };
  },
});

// ===========================================================================
// git_diff
// ===========================================================================

export const gitDiffTool: LocalTool = defineZodTool({
  name: 'git_diff',
  description:
    'Diff do repositório: lista name-status estruturada + patch unificado bruto. Opções: staged (índice vs HEAD), ref base, path.',
  input: z
    .object({
      staged: z.boolean().optional().describe('Diff do índice (staged) vs HEAD.'),
      ref: z.string().optional().describe('Ref/commit base para o diff.'),
      path: z.string().optional(),
      cwd: CwdInput,
    })
    .strict(),
  output: z.object({
    files: z.array(
      z.object({ status: z.string(), path: z.string(), origPath: z.string().optional() }),
    ),
    patch: z.string(),
    truncated: z.boolean(),
  }),
  capabilities: GIT_EXEC,
  pure: false,
  run: async (args, ctx) => {
    if (args.ref) assertSafeRef(args.ref);
    const cwd = resolveCwd(ctx, args.cwd);
    const common: string[] = [];
    if (args.staged) common.push('--staged');
    if (args.ref) common.push(args.ref);
    const tail: string[] = args.path ? ['--', args.path] : [];

    const ns = await runGit(ctx, ['diff', '--name-status', '-z', ...common, ...tail], {
      cwd,
      maxBuffer: BIG_BUFFER,
    });
    const patch = await runGit(ctx, ['diff', ...common, ...tail], { cwd, maxBuffer: BIG_BUFFER });

    return {
      files: parseDiffNameStatus(ns.stdout),
      patch: patch.stdout,
      truncated: ns.truncated || patch.truncated,
    };
  },
});

// ===========================================================================
// git_branch_list
// ===========================================================================

export const gitBranchListTool: LocalTool = defineZodTool({
  name: 'git_branch_list',
  description: 'Lista as branches locais, marcando qual é a atual (current).',
  input: z.object({ cwd: CwdInput }).strict(),
  output: z.object({
    branches: z.array(z.object({ name: z.string(), current: z.boolean() })),
  }),
  capabilities: GIT_EXEC,
  pure: false,
  run: async (args, ctx) => {
    const r = await runGit(ctx, ['branch', '--format=%(refname:short)%00%(HEAD)'], {
      cwd: resolveCwd(ctx, args.cwd),
    });
    return { branches: parseBranchList(r.stdout) };
  },
});

// ===========================================================================
// git_show_file
// ===========================================================================

export const gitShowFileTool: LocalTool = defineZodTool({
  name: 'git_show_file',
  description: 'Conteúdo de um arquivo em uma ref específica (ex.: HEAD:src/index.ts).',
  input: z
    .object({
      path: z.string().min(1),
      ref: z.string().optional().describe('Ref/commit (default HEAD).'),
      cwd: CwdInput,
    })
    .strict(),
  output: z.object({ content: z.string(), truncated: z.boolean() }),
  capabilities: GIT_EXEC,
  pure: false,
  run: async (args, ctx) => {
    const ref = args.ref ?? 'HEAD';
    assertSafeRef(ref);
    assertSafeRef(args.path, 'path');
    const r = await runGit(ctx, ['show', `${ref}:${args.path}`], {
      cwd: resolveCwd(ctx, args.cwd),
      maxBuffer: BIG_BUFFER,
    });
    return { content: r.stdout, truncated: r.truncated };
  },
});

// ===========================================================================
// git_blame
// ===========================================================================

export const gitBlameTool: LocalTool = defineZodTool({
  name: 'git_blame',
  description:
    'Blame estruturado de um arquivo: por linha, o commit (hash), autor e conteúdo. Ref opcional.',
  input: z
    .object({
      path: z.string().min(1),
      ref: z.string().optional(),
      cwd: CwdInput,
    })
    .strict(),
  output: z.object({
    lines: z.array(
      z.object({
        line: z.number(),
        hash: z.string(),
        author: z.string(),
        content: z.string(),
      }),
    ),
    truncated: z.boolean(),
  }),
  capabilities: GIT_EXEC,
  pure: false,
  run: async (args, ctx) => {
    assertSafeRef(args.path, 'path');
    const argv = ['blame', '--line-porcelain'];
    if (args.ref) {
      assertSafeRef(args.ref);
      argv.push(args.ref);
    }
    argv.push('--', args.path);
    const r = await runGit(ctx, argv, { cwd: resolveCwd(ctx, args.cwd), maxBuffer: BIG_BUFFER });
    return { lines: parseBlamePorcelain(r.stdout), truncated: r.truncated };
  },
});

// ===========================================================================
// git_commit
// ===========================================================================

export const gitCommitTool: LocalTool = defineZodTool({
  name: 'git_commit',
  description:
    'Cria um commit git com a mensagem fornecida. Se stageAll=true (default), executa ' +
    '`git add -A` antes — inclui arquivos novos, modificados e deletados. ' +
    'authorName/authorEmail sobrescrevem a identidade (útil em sandbox sem HOME).',
  input: z
    .object({
      message: z.string().min(1).describe('Mensagem de commit (semântica, ex.: "feat: adicionar X").'),
      stageAll: z.boolean().optional().default(true).describe('Executa git add -A antes do commit.'),
      authorName: z.string().optional().describe('Sobrescreve user.name (-c user.name=...).'),
      authorEmail: z.string().optional().describe('Sobrescreve user.email (-c user.email=...).'),
      cwd: CwdInput,
    })
    .strict(),
  output: z.object({
    hash: z.string(),
    branch: z.string(),
    message: z.string(),
  }),
  capabilities: GIT_EXEC,
  intent: 'write',
  pure: false,
  run: async (args, ctx) => {
    const cwd = resolveCwd(ctx, args.cwd);
    if (args.stageAll !== false) {
      await runGit(ctx, ['add', '-A'], { cwd });
    }
    const idArgs: string[] = [];
    if (args.authorName) idArgs.push('-c', `user.name=${args.authorName}`);
    if (args.authorEmail) idArgs.push('-c', `user.email=${args.authorEmail}`);
    // idArgs are global git flags — go before the subcommand, after BASE.
    await runGit(ctx, [...idArgs, 'commit', '-m', args.message], { cwd });
    const hashR = await runGit(ctx, ['rev-parse', 'HEAD'], { cwd });
    const branchR = await runGit(ctx, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    return {
      hash: hashR.stdout.trim(),
      branch: branchR.stdout.trim(),
      message: args.message,
    };
  },
});

// ===========================================================================
// git_checkout_branch
// ===========================================================================

export const gitCheckoutBranchTool: LocalTool = defineZodTool({
  name: 'git_checkout_branch',
  description:
    'Muda para uma branch existente ou cria uma nova (create=true). Útil para isolar ' +
    'refatorações perigosas em uma branch antes de executá-las.',
  input: z
    .object({
      name: z.string().min(1).describe('Nome da branch.'),
      create: z.boolean().optional().describe('Cria a branch se não existir (git checkout -b).'),
      cwd: CwdInput,
    })
    .strict(),
  output: z.object({
    branch: z.string(),
    created: z.boolean(),
  }),
  capabilities: GIT_EXEC,
  intent: 'write',
  pure: false,
  run: async (args, ctx) => {
    assertSafeRef(args.name, 'branch');
    const cwd = resolveCwd(ctx, args.cwd);
    const argv = args.create ? ['checkout', '-b', args.name] : ['checkout', args.name];
    await runGit(ctx, argv, { cwd });
    const r = await runGit(ctx, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    return { branch: r.stdout.trim(), created: !!args.create };
  },
});

// ===========================================================================
// git_restore
// ===========================================================================

export const gitRestoreTool: LocalTool = defineZodTool({
  name: 'git_restore',
  description:
    'Descarta alterações na árvore de trabalho de um ou mais arquivos (`git restore -- <paths>`). ' +
    'Se staged=true, desfaz o stage (`git restore --staged`). ' +
    'ATENÇÃO: as alterações na working tree são perdidas permanentemente.',
  input: z
    .object({
      paths: z.array(z.string().min(1)).min(1).describe('Caminhos relativos ao workspace (mínimo 1).'),
      staged: z.boolean().optional().describe('Desfaz o stage (--staged) em vez da working tree.'),
      cwd: CwdInput,
    })
    .strict(),
  output: z.object({
    restored: z.number().describe('Número de caminhos processados.'),
  }),
  capabilities: GIT_EXEC,
  intent: 'destructive',
  pure: false,
  run: async (args, ctx) => {
    const cwd = resolveCwd(ctx, args.cwd);
    for (const p of args.paths) assertSafeRef(p, 'path');
    const flags = args.staged ? ['restore', '--staged', '--'] : ['restore', '--'];
    await runGit(ctx, [...flags, ...args.paths], { cwd });
    return { restored: args.paths.length };
  },
});

// ===========================================================================
// git_revert
// ===========================================================================

export const gitRevertTool: LocalTool = defineZodTool({
  name: 'git_revert',
  description:
    'Cria um novo commit que desfaz as mudanças de um commit específico ' +
    '(`git revert --no-edit <commit>`). Útil para rollback automático em caso de ' +
    'falha irreversível no loop de auto-cura.',
  input: z
    .object({
      commit: z.string().min(1).describe('Hash ou ref do commit a reverter.'),
      cwd: CwdInput,
    })
    .strict(),
  output: z.object({
    hash: z.string().describe('Hash do novo commit de revert.'),
    message: z.string().describe('Mensagem do commit de revert.'),
  }),
  capabilities: GIT_EXEC,
  intent: 'write',
  pure: false,
  run: async (args, ctx) => {
    assertSafeRef(args.commit, 'commit');
    const cwd = resolveCwd(ctx, args.cwd);
    await runGit(ctx, ['revert', '--no-edit', args.commit], { cwd });
    const hashR = await runGit(ctx, ['rev-parse', 'HEAD'], { cwd });
    const msgR = await runGit(ctx, ['log', '-1', '--pretty=format:%s'], { cwd });
    return { hash: hashR.stdout.trim(), message: msgR.stdout.trim() };
  },
});

/** Todas as tools do namespace git/. */
export const gitTools: LocalTool[] = [
  gitStatusTool,
  gitCurrentBranchTool,
  gitLogTool,
  gitDiffTool,
  gitBranchListTool,
  gitShowFileTool,
  gitBlameTool,
  gitCommitTool,
  gitCheckoutBranchTool,
  gitRestoreTool,
  gitRevertTool,
];

// Utilitários internos reexportados para reuso por futuras tools git.
export { BASE, GIT_EXEC, assertSafeRef, gitError, resolveCwd, runGit };
