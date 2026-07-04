/**
 * @clover/contracts — Tipos compartilhados do CloverOS (a TCB de tipos).
 *
 * Este pacote NÃO tem dependências de runtime. É a fonte única dos contratos
 * entre kernel, IR, executor, tool-abi e event-bus. Mantê-lo pequeno e estável.
 *
 * Referência de arquitetura: docs/architecture/cloveros-rap.md
 */

// ===========================================================================
// Event Bus (RAP §11.10)
// ===========================================================================

/** Envelope de um evento publicado no Event Bus. */
export interface EventEnvelope<T = unknown> {
  /** Id único do evento (gerado pelo bus se omitido na publicação). */
  id: string;
  /** Tópico hierárquico, ex.: 'node:done', 'task:submitted'. */
  topic: string;
  /** Correlação ponta-a-ponta (uma task/turno). */
  traceId: string;
  /** Span opcional dentro do trace (um nó, uma tool). */
  spanId?: string;
  /** Epoch ms. */
  ts: number;
  /** Quem emitiu (nome do subsistema/ator). */
  source: string;
  /** Carga do evento. */
  payload: T;
}

/** Evento publicável: o bus completa id/ts/traceId ausentes. */
export type PublishableEvent<T = unknown> = Omit<EventEnvelope<T>, 'id' | 'ts'> & {
  id?: string;
  ts?: number;
};

export type EventHandler<T = unknown> = (evt: EventEnvelope<T>) => void;
export type Unsubscribe = () => void;

// ===========================================================================
// Intermediate Representation — Plan IR (RAP §6)
// ===========================================================================

/**
 * Um plano é um DAG acíclico de passos com bindings de dados. Declarativo e
 * NÃO Turing-completo: sem loops/recursão arbitrários. O modelo autora IR
 * (validada), nunca código executável.
 */
export interface PlanIR {
  version: '1';
  /** Id da meta que originou o plano. */
  goalId: string;
  nodes: IRNode[];
  /** Arestas explícitas de ordem/dependência (além das inferidas por refs). */
  edges: IREdge[];
  /** O que o plano "retorna" (refs a saídas de nós). */
  outputs: IRRef[];
}

/** Tipos de nó suportados. O skeleton implementa `tool_call`; demais reservados. */
export type IRNode = ToolCallNode | TransformNode;

/** Invocação de uma ferramenta da Tool ABI. */
export interface ToolCallNode {
  kind: 'tool_call';
  id: string;
  /** Nome da tool na Tool ABI. */
  tool: string;
  /** Argumentos: literais e/ou refs a saídas de nós anteriores. */
  args: Record<string, IRValue>;
  /** Capabilities mínimas exigidas por este nó. */
  capabilities?: CapabilityRequest[];
  /** Política de retry opcional. */
  retry?: RetryPolicy;
  /** Marca o nó como cacheável (apenas tools puras). */
  cacheable?: boolean;
}

/**
 * Transformação declarativa pura (sem eval). Reservado para a próxima fatia;
 * declarado aqui para estabilidade do contrato.
 */
export interface TransformNode {
  kind: 'transform';
  id: string;
  op: 'concat' | 'template' | 'pick';
  args: Record<string, IRValue>;
}

export interface IREdge {
  from: string;
  to: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs?: number;
}

/** Referência à saída de um nó, opcionalmente em um caminho (ex.: 'files.0'). */
export interface IRRef {
  kind: 'ref';
  nodeId: string;
  /** Caminho por pontos dentro do output do nó (ex.: 'text', 'files.0'). */
  path?: string;
}

/** Valor da IR: literal, ref, array ou objeto cujos valores também são IRValue. */
export type IRValue =
  | string
  | number
  | boolean
  | null
  | IRRef
  | IRValue[]
  | { [k: string]: IRValue };

/** Type guard para IRRef. */
export function isIRRef(v: unknown): v is IRRef {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { kind?: unknown }).kind === 'ref' &&
    typeof (v as IRRef).nodeId === 'string'
  );
}

// ===========================================================================
// Tool ABI (RAP §11.12)
// ===========================================================================

/** JSON Schema (forma frouxa; refinada por adapters concretos). */
export type JsonSchema = Record<string, unknown>;

/**
 * Intenção de efeito de uma tool — sinal de **aprovação/auditoria**, não de
 * contenção (a contenção é o capability-token + fronteira de workspace). O
 * Governor exige autorização do Resource Manager para `write`/`destructive`.
 * Uma tool `write` DEVE também declarar a capability correspondente (ex.:
 * `fs.write`) — `intent` e capability andam juntos.
 */
export type ToolIntent = 'read' | 'write' | 'destructive';

/** Descritor uniforme de uma ferramenta — local, MCP, WASM ou remota. */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  /** Capabilities que a tool exige para executar. */
  capabilities: CapabilityRequest[];
  /** Idempotente/sem efeitos colaterais → cacheável. */
  pure?: boolean;
  /** Intenção de efeito (default `read`). `write`/`destructive` exigem autorização. */
  intent?: ToolIntent;
  origin: 'local' | 'mcp' | 'wasm' | 'remote';
}

/** Resultado padronizado de uma execução de tool. */
export interface ToolResult {
  success: boolean;
  /** Saída estruturada da tool (resolvível por IRRef). */
  output: unknown;
  error?: string;
}

/** Contexto injetado em cada invocação de tool. */
export interface ToolInvocation {
  taskId: string;
  traceId: string;
  workspacePath: string;
  /** Token concedido à task; a tool só recebe o que foi autorizado. */
  token: CapabilityToken;
  emit: (topic: string, payload: unknown) => void;
}

// ===========================================================================
// Capability System (RAP §10) — núcleo presente; enforcement forte na Fatia 2
// ===========================================================================

export type Capability =
  | { kind: 'fs.read'; pathGlob: string }
  | { kind: 'fs.write'; pathGlob: string }
  | { kind: 'proc.exec'; argv0Allow: string[]; maxProcs: number }
  | { kind: 'net'; hostAllow: string[] }
  | { kind: 'tool'; name: string }
  | { kind: 'llm'; model: string; maxTokens: number };

export type CapabilityKind = Capability['kind'];

export interface CapabilityRequest {
  kind: CapabilityKind;
  /** Dica de escopo (ex.: nome da tool, glob de path). */
  scopeHint?: string;
}

export interface CapabilityToken {
  id: string;
  taskId: string;
  caps: Capability[];
  issuedAt: number;
  expiresAt: number;
  /** Assinatura (HMAC/ed25519). No skeleton: 'unsigned-dev'. */
  sig: string;
}

// ===========================================================================
// Execução / Task (RAP §11.1, §11.3, §12)
// ===========================================================================

export interface Goal {
  id: string;
  text: string;
  workspacePath: string;
}

export type TaskStatus =
  | 'submitted'
  | 'planning'
  | 'ready'
  | 'running'
  | 'paused'
  | 'verifying'
  | 'done'
  | 'failed';

/** Eventos emitidos pela Execution Engine (RAP §11.3). */
export type ExecEvent =
  | { type: 'plan:start'; taskId: string; nodeCount: number }
  | { type: 'node:start'; taskId: string; nodeId: string; tool?: string }
  | { type: 'node:done'; taskId: string; nodeId: string; output: unknown }
  | { type: 'node:skipped'; taskId: string; nodeId: string }
  | { type: 'node:fault'; taskId: string; nodeId: string; fault: ExecutionFault }
  | { type: 'checkpoint'; taskId: string; completed: string[] }
  | { type: 'plan:done'; taskId: string; outputs: unknown[] }
  | { type: 'plan:failed'; taskId: string; fault: ExecutionFault };

export interface ExecutionFault {
  code:
    | 'validation'
    | 'capability_denied'
    | 'authorization_denied'
    | 'tool_not_found'
    | 'tool_error'
    | 'ref_unresolved'
    | 'cycle';
  message: string;
  nodeId?: string;
}

/** Resultado de uma execução de plano. */
export interface RunResult {
  taskId: string;
  status: Extract<TaskStatus, 'done' | 'failed'>;
  /** Saídas finais (resolvidas a partir de plan.outputs). */
  outputs: unknown[];
  /** Saída por nó (para depuração/bindings). */
  nodeOutputs: Record<string, unknown>;
  fault?: ExecutionFault;
}
