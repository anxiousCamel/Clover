/**
 * @clover/capability — Capability tokens assinados (RAP §10; corrige P4).
 *
 * Cada task recebe um token de **menor privilégio**, derivado do Plan IR + das
 * capabilities declaradas por cada tool. O token é **assinado (HMAC-SHA256)** e
 * **time-boxed**: qualquer adulteração (ex.: ampliar `caps`) ou expiração é
 * detectada por `verify`. Isto é a costura para execução fora do processo
 * (sandbox): um componente que recebe o token prova que ele não foi forjado nem
 * ampliado.
 *
 * Tudo aqui é puro `node:crypto` — sem dependências nativas.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type {
  Capability,
  CapabilityRequest,
  CapabilityToken,
  PlanIR,
  ToolDescriptor,
} from '@clover/contracts';

const DEFAULT_SECRET = 'clover-dev-secret';
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export interface MintOptions {
  /** Descritores das tools referenciadas — fonte das caps de recurso (fs/net/...). */
  tools?: ToolDescriptor[];
  secret?: string;
  ttlMs?: number;
  /** Override do relógio (testes). */
  now?: number;
}

export interface VerifyOptions {
  secret?: string;
  now?: number;
}

/** Campos do token cobertos pela assinatura (tudo menos `sig`). */
type TokenBase = Omit<CapabilityToken, 'sig'>;

export class CapabilityResolver {
  constructor(private readonly secret: string = DEFAULT_SECRET) {}

  /** Cunha o token mínimo (menor privilégio) que cobre o plano. */
  mint(plan: PlanIR, taskId: string, opts: MintOptions = {}): CapabilityToken {
    const now = opts.now ?? Date.now();
    const base: TokenBase = {
      id: randomUUID(),
      taskId,
      caps: deriveCaps(plan, opts.tools ?? []),
      issuedAt: now,
      expiresAt: now + (opts.ttlMs ?? DEFAULT_TTL_MS),
    };
    return { ...base, sig: sign(base, opts.secret ?? this.secret) };
  }

  /** Valida assinatura + expiração. Detecta adulteração de `caps`. */
  verify(token: CapabilityToken, opts: VerifyOptions = {}): boolean {
    const now = opts.now ?? Date.now();
    const { sig, ...base } = token;
    const expected = sign(base, opts.secret ?? this.secret);
    if (!safeEqualHex(sig, expected)) return false;
    if (now >= token.expiresAt) return false;
    return true;
  }

  /** O token concede a capability requerida? (menor privilégio é enforced aqui.) */
  authorize(token: CapabilityToken, req: CapabilityRequest): boolean {
    return token.caps.some((c) => satisfies(c, req));
  }
}

// ===========================================================================
// Derivação de capabilities
// ===========================================================================

export function deriveCaps(plan: PlanIR, tools: ToolDescriptor[]): Capability[] {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const caps: Capability[] = [];

  const toolNames = new Set<string>();
  for (const node of plan.nodes) {
    if (node.kind === 'tool_call') toolNames.add(node.tool);
  }

  for (const name of toolNames) {
    caps.push({ kind: 'tool', name });
    const descriptor = byName.get(name);
    if (descriptor) {
      for (const req of descriptor.capabilities) {
        const cap = requestToCapability(req);
        if (cap) caps.push(cap);
      }
    }
  }
  return dedupe(caps);
}

/** Converte uma CapabilityRequest declarada por uma tool em uma Capability concreta. */
export function requestToCapability(req: CapabilityRequest): Capability | null {
  switch (req.kind) {
    case 'fs.read':
      return { kind: 'fs.read', pathGlob: req.scopeHint ?? '**' };
    case 'fs.write':
      return { kind: 'fs.write', pathGlob: req.scopeHint ?? '**' };
    case 'net':
      return { kind: 'net', hostAllow: req.scopeHint ? [req.scopeHint] : [] };
    case 'proc.exec':
      return { kind: 'proc.exec', argv0Allow: req.scopeHint ? [req.scopeHint] : [], maxProcs: 1 };
    case 'tool':
      return req.scopeHint ? { kind: 'tool', name: req.scopeHint } : null;
    case 'llm':
      return { kind: 'llm', model: req.scopeHint ?? '*', maxTokens: 0 };
    default:
      return null;
  }
}

function satisfies(cap: Capability, req: CapabilityRequest): boolean {
  if (cap.kind !== req.kind) return false;
  if (cap.kind === 'tool') return !req.scopeHint || cap.name === req.scopeHint;
  // Escopo fino (globs de path, hosts) é enforced no sandbox; aqui o casamento
  // de tipo já garante o menor privilégio em nível de classe de recurso.
  return true;
}

// ===========================================================================
// Assinatura
// ===========================================================================

/** Serialização determinística dos campos assinados (ordem fixa por array). */
function payload(base: TokenBase): string {
  return JSON.stringify([base.id, base.taskId, base.caps, base.issuedAt, base.expiresAt]);
}

function sign(base: TokenBase, secret: string): string {
  return createHmac('sha256', secret).update(payload(base)).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function dedupe(caps: Capability[]): Capability[] {
  const seen = new Set<string>();
  const out: Capability[] = [];
  for (const c of caps) {
    const key = JSON.stringify(c);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}
