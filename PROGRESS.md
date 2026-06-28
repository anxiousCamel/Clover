# CloverOS — PROGRESS

> Estado vivo da execução do roadmap do CloverOS. Mantido pelo "Scheduler" (agente).
> A cada mudança de fase: registrar o que foi concluído e **por que** algo foi
> reordenado/pulado. Referência de arquitetura: `docs/architecture/cloveros-rap.md`
> e ADRs 003–005.

---

## Modelo de execução

- **Autonomia de fluxo:** as Fases do roadmap podem ser reordenadas quando um item de
  uma fase posterior for **pré-requisito lógico** de uma anterior.
- **Execução contínua:** sem pausa para aprovação entre etapas.
- **Yield (pausa + pergunta):** somente diante de impedimento técnico real ou
  ambiguidade arquitetural que comprometa a integridade do sistema.

---

## Decisão de reordenação #1 — Walking Skeleton primeiro (vertical slice)

**Contexto:** a missão é fazer o **Kernel rodar um script de teste simples** o quanto
antes. O roadmap do RAP é organizado por maturidade de capacidade (Fase 0 Fundações →
Fase 1 IR → Fase 2 Segurança → Fase 3 Cognição/Tools). Executar fase-a-fase
(horizontal) não produz nada executável até tarde.

**Decisão:** executar primeiro um **walking skeleton** — uma fatia vertical fina que
atravessa três fases:

- **Fase 0 (parcial):** `@clover/contracts` (tipos), `@clover/event-bus` (backbone).
- **Fase 1 (núcleo):** `@clover/ir` (schema + validator + topo-sort), `@clover/executor`
  (IR VM / DAG runner).
- **Fase 3 (puxada para frente):** `@clover/tool-abi` (ABI + registry + bridge) e duas
  tools triviais (`echo`, `concat`).

**Por que puxar a Fase 3 (Tool ABI) para antes da Fase 2 (Segurança):** o Executor
(Fase 1) **não consegue demonstrar execução** sem uma ferramenta para invocar — a
função inteira da IR VM é orquestrar tool calls. Logo, a **Tool ABI é pré-requisito
lógico** de um executor executável. (É exatamente o caso previsto na missão: "se a
Fase 3 for pré-requisito da Fase 2, rode-a primeiro.")

**Por que a Fase 2 (Capabilities/Sandbox) é parcialmente adiada:** o skeleton roda
tools **confiáveis in-process**. Mesmo assim, a *costura* de segurança já é exercida:
o Kernel cunha um `CapabilityToken` de **menor privilégio** (apenas as tools
referenciadas no plano) e o Executor **bloqueia** qualquer tool fora do token. O
enforcement forte (sandbox em camadas: isolated-vm/WASM/processo) entra na próxima
fatia.

**O que NÃO entra no skeleton (e por quê):** persistência do estado (event store /
snapshots — Fase 0 restante) fica para a Fatia 2; o skeleton emite eventos de
`checkpoint` no Event Bus mas ainda não os persiste. LLM, Planner e constrained
decoding (Fase 1 restante) vêm depois — o skeleton recebe um Plan IR pré-construído
para provar a espinha primeiro.

---

## Status das Fatias

### Fatia 1 — Walking Skeleton (Kernel roda um Plan IR) — ✅ CONCLUÍDA
Objetivo: `kernel.submitPlan(plan)` executa um DAG de 2 nós (`echo "hello"` →
`concat` com `" world"`) e produz `"hello world"`, com validação de IR, resolução de
bindings (`IRRef`), gate de capability e eventos no Event Bus.

Pacotes (todos em `packages/`):
- [x] `@clover/contracts` — tipos da TCB (EventEnvelope, PlanIR/IRNode/IRRef,
      ToolDescriptor, Capability/Token, ExecEvent, RunResult).
- [x] `@clover/event-bus` — pub/sub síncrono com tópicos hierárquicos + wildcard.
- [x] `@clover/ir` — `validatePlan` (ids únicos, refs resolvíveis, DAG acíclico),
      `topoSort`, `executionLevels` (base de paralelização), `optimize` (identidade).
- [x] `@clover/tool-abi` — `ToolDescriptor`/`ToolRegistry`/`LocalToolBridge`/`defineTool`.
- [x] `@clover/executor` — IR VM / DAG runner (Tier 0): valida → níveis → executa,
      resolve bindings, gate de capability, emite eventos + checkpoints.
- [x] `@clover/kernel` — facade (Event Bus + Registry + CapabilityResolver + Engine),
      `submitPlan`, `createKernel`; tools demo (`echo`, `concat`); teste + demo.

**Verificação (executada):**
- `pnpm --filter @clover/kernel exec vitest run` → **5/5 testes verdes** (happy path,
  ordem de dependência, capability negada, plano inválido, menor privilégio).
- `pnpm exec tsc --build packages/kernel/tsconfig.json` → **exit 0** (typecheck de
  todo o grafo de pacotes).
- `node packages/kernel/dist/demo.js` → timeline de eventos + `outputs: ["hello world"]`.

**Notas técnicas de build (para as próximas fatias):**
- Testes resolvem os pacotes via alias para `src` (`packages/kernel/vitest.config.ts`)
  — não exigem build.
- Execução por Node usa o artefato buildado (`build` → `node dist/...`), conforme a
  convenção do monorepo (libs buildam para `dist`).
- Pacotes que usam builtins do Node declaram `"types": ["node"]` + `@types/node`
  (necessário sob `tsc --build` com symlinks do pnpm).
- A *costura* de segurança já existe: o Kernel cunha token de menor privilégio e o
  Executor **nega** tools fora do token (teste cobre). Enforcement de sandbox forte
  vem na Fatia 2.

---

## Próximas fatias (planejadas)

- **Fatia 2 — Estado durável + Segurança real:** `@clover/state` (event store
  append-only + snapshots + projeções), `@clover/capability` (resolver dedicado),
  `@clover/sandbox` (Tier 0 IR VM já existe; adicionar isolated-vm/WASM/processo),
  `@clover/resource-manager`. Fecha Fase 0 e Fase 2.
- **Fatia 3 — Cognição:** `@clover/scheduler` durável, `@clover/planner`
  (constrained decoding → Plan IR via `@clover/llm`), `@clover/context-builder`,
  `@clover/tool-search`. Fecha Fase 1 e Fase 3.
