/**
 * CapabilityResolver (mínimo) — cunha um token de MENOR PRIVILÉGIO a partir do
 * Plan IR: concede exatamente as tools referenciadas, nada mais (RAP §10).
 *
 * Fatia 1: token não-assinado de desenvolvimento ('unsigned-dev') e cobre apenas
 * caps do tipo `tool`. Assinatura (HMAC/ed25519) e caps de fs/net/proc com
 * enforcement de sandbox entram na Fatia 2 (ver PROGRESS.md).
 */

import { randomUUID } from 'node:crypto';

import type { Capability, CapabilityToken, PlanIR } from '@clover/contracts';

export interface MintOptions {
  /** Validade do token em ms (default 1h). */
  ttlMs?: number;
}

export class CapabilityResolver {
  /** Calcula o conjunto mínimo de capabilities exigido pelo plano. */
  mint(plan: PlanIR, taskId: string, opts: MintOptions = {}): CapabilityToken {
    const toolNames = new Set<string>();
    for (const node of plan.nodes) {
      if (node.kind === 'tool_call') toolNames.add(node.tool);
    }
    const caps: Capability[] = [...toolNames].map((name) => ({ kind: 'tool', name }));

    const now = Date.now();
    return {
      id: randomUUID(),
      taskId,
      caps,
      issuedAt: now,
      expiresAt: now + (opts.ttlMs ?? 60 * 60 * 1000),
      sig: 'unsigned-dev',
    };
  }
}
