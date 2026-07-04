/**
 * @clover/agent — Wiring de cognição ponta-a-ponta (RAP §13: fluxo completo).
 *
 * Liga **Context Builder → Planner → Scheduler durável**, sob governança do
 * **Resource Manager**. O fluxo de uma meta:
 *
 *   goal
 *     → ContextBuilder.build (Tool Search seleciona só as tools relevantes —
 *       não afoga o LLM com tokens)
 *     → Planner.plan (LLM sob constrained decoding → Plan IR, usando apenas as
 *       tools selecionadas)
 *     → ResourceManager.run(Scheduler.submit) (execução durável, com limite de
 *       concorrência; eventos no Event Bus, persistidos no journal)
 *
 * Cada `run` é independente (taskId próprio) — o que torna seguro rodar muitos
 * em paralelo como atores isolados (ver testes).
 */

import type { Goal, RunResult } from '@clover/contracts';
import { gitCleanTool, gitRestoreTool } from '@clover/tools';

export interface HealOptions {
  /** Máximo de tentativas totais (1 original + N re-planejamentos). Default: 2. */
  maxAttempts?: number;
  /**
   * Chamada se todas as tentativas falharem. Recebe o caminho do workspace.
   * Padrão: executa `git restore -- .` para descartar mudanças na working tree.
   * Injete um callback para testes ou comportamentos alternativos.
   */
  onFinalFailure?: (workspacePath: string) => Promise<void> | void;
}
import {
  ContextBuilder,
  type BuiltContext,
  type MemoryChunk,
  type TokenBudget,
} from '@clover/context-builder';
import type { Kernel } from '@clover/kernel';
import type { KnowledgeRetriever } from '@clover/knowledge-retriever';
import type { Planner } from '@clover/planner';
import type { ResourceManager } from '@clover/resource-manager';
import type { DurableScheduler } from '@clover/scheduler';
import type { ToolSearch } from '@clover/tool-search';

export interface AgentKnowledge {
  retriever: KnowledgeRetriever;
  /** Máx. de snippets estruturais candidatos (o orçamento decide o que entra). */
  maxSnippets?: number;
}

export interface AgentDeps {
  kernel: Kernel;
  scheduler: DurableScheduler;
  planner: Planner;
  contextBuilder: ContextBuilder;
  resourceManager: ResourceManager;
  toolSearch: ToolSearch;
  /** Recuperação estrutural (AST/KG) opcional, alimentada ao contexto. */
  knowledge?: AgentKnowledge;
  budget?: TokenBudget;
  maxTools?: number;
}

export interface AgentRunResult {
  goal: Goal;
  context: BuiltContext;
  taskId: string;
  result: RunResult;
}

/**
 * Rollback padrão (total): descarta TODAS as alterações da working tree.
 *
 *   1. `git restore -- .` reverte modificações de arquivos rastreados;
 *   2. `git clean -fd` remove arquivos/dirs NÃO rastreados que a tentativa falha
 *      tenha criado (respeita `.gitignore`) — sem isso, o passo 1 deixaria lixo.
 *
 * Só é chamado no **caminho de falha final** do loop de auto-cura (nunca entre
 * tentativas). Best-effort: falhas (repo sem git, tree limpa) não propagam — o
 * sinal de falha de build já está no resultado devolvido ao caller.
 */
async function defaultRollback(workspacePath: string, taskId: string): Promise<void> {
  const ctx = {
    taskId,
    traceId: 'auto-rollback',
    workspacePath,
    token: {
      id: `rollback-${taskId}`,
      taskId,
      caps: [{ kind: 'proc.exec' as const, argv0Allow: ['git'], maxProcs: 2 }],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 30_000,
      sig: 'auto-rollback',
    },
    emit: () => {},
  };
  // Tracked: reverte. Untracked: remove. Ordem importa pouco (independentes).
  await gitRestoreTool.handler({ paths: ['.'] }, ctx);
  await gitCleanTool.handler({}, ctx);
}

/**
 * Extrai a mensagem de erro de um resultado de `run_build_and_test` com falha.
 * Retorna null se não houver output de build ou se o build passou.
 */
function extractBuildFailure(result: RunResult): string | null {
  for (const out of result.outputs) {
    if (
      typeof out === 'object' &&
      out !== null &&
      'success' in out &&
      (out as { success: unknown }).success === false &&
      'stderr' in out &&
      typeof (out as { stderr: unknown }).stderr === 'string' &&
      ((out as { stderr: string }).stderr.length > 0 ||
        ('failedCommand' in out && (out as { failedCommand: unknown }).failedCommand !== null))
    ) {
      const o = out as { stderr: string; failedCommand?: string | null };
      return o.stderr || `comando falhou: ${o.failedCommand ?? 'desconhecido'}`;
    }
  }
  return null;
}

export class Agent {
  constructor(private readonly deps: AgentDeps) {}

  async run(goal: Goal): Promise<AgentRunResult> {
    const tools = this.deps.kernel.listTools();

    // 0) Recuperação estrutural (AST/KG): snippets candidatos para o contexto.
    let memory: MemoryChunk[] = [];
    if (this.deps.knowledge) {
      memory = this.deps.knowledge.retriever
        .retrieve(goal.text, { topK: this.deps.knowledge.maxSnippets ?? 5 })
        .map((s) => ({ text: s.text, source: s.source }));
    }

    // 1) Context Builder: orçamento de tokens + Tool Search seleciona relevantes.
    //    O orçamento decide quais snippets estruturais (memory) realmente entram.
    const context = this.deps.contextBuilder.build({
      query: goal.text,
      budget: this.deps.budget ?? { maxTokens: 4096 },
      tools,
      toolSearch: this.deps.toolSearch,
      maxTools: this.deps.maxTools ?? 8,
      memory,
    });

    // 2) Planner: gera o Plan IR usando SOMENTE as tools selecionadas, alimentado
    //    pelo contexto estrutural que coube no orçamento (antes do planejamento).
    const contextText = context.selectedMemory.map((m) => m.text).join('\n');
    const plan = await this.deps.planner.plan(goal, context.tools, { contextText });

    // 3) Resource Manager governa a execução durável do Scheduler.
    const submitted = await this.deps.resourceManager.run(() =>
      this.deps.scheduler.submit(plan, { workspacePath: goal.workspacePath }),
    );

    return { goal, context, taskId: submitted.taskId, result: submitted.result };
  }

  /**
   * Executa `run()` com um laço de auto-cura: se o resultado contiver um output
   * de `run_build_and_test` com falha, re-planeja injetando o stderr como contexto.
   * Máximo de `maxAttempts` tentativas totais (default: 2 — 1 original + 1 cura).
   */
  async runWithHeal(goal: Goal, opts: HealOptions = {}): Promise<AgentRunResult> {
    const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
    let currentGoal = goal;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const run = await this.run(currentGoal);
      const failure = extractBuildFailure(run.result);

      if (!failure) return run; // Sucesso — sem rollback necessário.

      if (attempt === maxAttempts - 1) {
        // Última tentativa: aciona rollback automático antes de retornar.
        if (opts.onFinalFailure) {
          await opts.onFinalFailure(goal.workspacePath);
        } else {
          await defaultRollback(goal.workspacePath, run.taskId);
        }
        return run;
      }

      // Injeta o erro de build no objetivo para o próximo planejamento.
      currentGoal = {
        ...goal,
        text:
          `${goal.text}\n\n` +
          `[Auto-cura — tentativa ${attempt + 1}/${maxAttempts - 1} falhou. ` +
          `Corrija o erro antes de finalizar]\n` +
          `Erro de build/test:\n${failure}`,
      };
    }
    // Não deve chegar aqui (o loop sempre retorna dentro).
    return this.run(currentGoal);
  }
}
