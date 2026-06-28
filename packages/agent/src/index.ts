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
}
