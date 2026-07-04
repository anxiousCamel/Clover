/**
 * Namespace `dev/` — Departamento de Engenharia.
 *
 * `search_code`: busca de código otimizada. Prefere **Ripgrep** (via Sandbox,
 * respeita `.gitignore`); se ausente, usa o fallback Node.
 * `run_build_and_test`: detecta PM e roda build/testes; alimenta o loop de
 * auto-cura do Agente com stderr legível em caso de falha.
 */

import { resolve } from 'node:path';

import type { CapabilityRequest } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';
import { z } from 'zod';

import { defineZodTool } from '../abi.js';
import { detectBinary, runBinary } from '../sys/exec.js';
import { resolveInWorkspace } from '../sys/fs.js';
import { parseRgLines, walkSearch } from './search.js';
import { runBuildAndTestTool } from './build.js';

/** rg (via Sandbox) + fs.read (fallback Node). */
const SEARCH_CAPS: CapabilityRequest[] = [
  { kind: 'proc.exec', scopeHint: 'rg' },
  { kind: 'fs.read' },
];

export const searchCodeTool: LocalTool = defineZodTool({
  name: 'search_code',
  description:
    'Busca literal de código no workspace (Ripgrep se disponível; fallback Node). Ignora .git e node_modules. Retorna arquivo, linha e trecho.',
  input: z
    .object({
      query: z.string().min(1),
      path: z.string().optional().describe('Subdiretório relativo ao workspace (default: raiz).'),
      maxResults: z.number().int().min(1).max(2000).optional().describe('Teto de resultados (default 200).'),
      ignoreCase: z.boolean().optional(),
    })
    .strict(),
  output: z.object({
    matches: z.array(z.object({ file: z.string(), line: z.number(), text: z.string() })),
    truncated: z.boolean(),
    engine: z.enum(['ripgrep', 'fallback']),
  }),
  capabilities: SEARCH_CAPS,
  intent: 'read',
  pure: false,
  run: async (args, ctx) => {
    const cap = args.maxResults ?? 200;
    // Valida a fronteira do subdiretório antes de qualquer motor (rg não checa).
    if (args.path) resolveInWorkspace(ctx, args.path);

    const rg = await detectBinary(ctx, 'rg');
    if (rg.available) {
      const rgArgs = [
        '--line-number',
        '--no-heading',
        '--color=never',
        '--fixed-strings',
        '--glob=!.git',
        '--glob=!node_modules',
      ];
      if (args.ignoreCase) rgArgs.push('-i');
      rgArgs.push('-e', args.query);
      if (args.path) rgArgs.push('--', args.path);

      const r = await runBinary({ bin: 'rg', args: rgArgs, ctx, timeoutMs: 20_000, maxBuffer: 8 * 1024 * 1024 });
      // rg: exit 1 = "nenhum resultado" (não é erro); >1 = erro real.
      if (!r.ok && r.exitCode !== 1) {
        throw new Error(`ripgrep: ${(r.stderr || '').split('\n')[0] || `exit ${r.exitCode}`}`);
      }
      const parsed = parseRgLines(r.stdout, cap);
      return { matches: parsed.matches, truncated: parsed.truncated || r.truncated, engine: 'ripgrep' as const };
    }

    // Fallback Node.
    const root = args.path ? resolveInWorkspace(ctx, args.path) : resolve(ctx.workspacePath);
    const res = walkSearch(root, resolve(ctx.workspacePath), args.query, args.ignoreCase ?? false, cap);
    return { matches: res.matches, truncated: res.truncated, engine: 'fallback' as const };
  },
});

export { runBuildAndTestTool } from './build.js';

/** Todas as tools do namespace dev/. */
export const devTools: LocalTool[] = [searchCodeTool, runBuildAndTestTool];
