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

## Decisão de reordenação #2 — Planner (geração restrita) antes de Estado/Sandbox

**Contexto:** com o skeleton rodando um Plan IR pré-construído, o próximo passo de
maior valor é fechar a pergunta "**de onde vem o Plan IR?**" — a tese central da
arquitetura (ADR-004): LLM → IR sob **constrained decoding**.

**Decisão:** executar a **Fatia 2 = Planner + geração restrita** antes de estado
durável (resto da Fase 0) e do enforcement de sandbox (Fase 2).

**Por quê:**
1. O RAP marca a **Fase 1 (IR + Determinismo) como "maior ROI"**; o Planner é seu
   item-cabeça e materializa a tese (geração restrita → IR válida → execução).
2. É **100% verificável offline** com um provider determinístico (`MockProvider`):
   zero risco ambiental.
3. Estado durável (`better-sqlite3`) e sandbox (`isolated-vm`/`wasmtime`) exigem
   **builds nativos** cuja disponibilidade neste ambiente é incerta. Sequenciá-los
   depois permite **desriscar/validar deliberadamente** cada um, em vez de bloquear o
   trabalho de maior ROI. (O `OllamaProvider` real foi escrito atrás do port, mas o
   caminho ao vivo só roda com um Ollama ativo — não exercitado nos testes.)

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

### Fatia 2 — Planner + Geração Restrita (LLM → IR) — ✅ CONCLUÍDA
Objetivo: dado uma meta + tools disponíveis, gerar um **Plan IR válido** via LLM sob
constrained decoding, com laço **gerar → parsear → validar → reparar**. Fecha o
item-cabeça da Fase 1 (a tese do ADR-004).

Pacotes:
- [x] `@clover/llm` — port `LlmProvider`; `MockProvider` (determinístico, testes);
      `OllamaProvider` (structured outputs via `format` = JSON Schema; caminho real,
      exige Ollama ativo — não exercitado offline).
- [x] `@clover/planner` — `buildPlanSchema(tools)` (restringe `tool` ao enum de tools
      disponíveis — o modelo não inventa ferramenta), prompt builder, `tryParseJson`
      (tolera cercas markdown), `normalizePlan` (fixa `goalId`), `validateCandidate`
      (estrutural via `@clover/ir` + semântica: toda tool existe), e o laço de reparo.

**Verificação (executada):**
- `pnpm --filter @clover/planner exec vitest run` → **6/6 testes verdes**: schema
  restringe nomes de tool; plano válido + `goalId` autoritativo; **end-to-end
  Planner → Kernel → `["hello world"]`**; reparo após tool desconhecida (2ª tentativa
  carrega o motivo); `PlanningError` quando o JSON nunca é válido; strip de cercas.
- `pnpm --filter @clover/kernel exec vitest run` → **5/5** (sem regressão).
- `pnpm exec tsc --build packages/planner ... packages/kernel ...` → **exit 0**
  (grafo de 8 pacotes).

**Separação de responsabilidades (chave do design):** o **decoder** garante a
ESTRUTURA (schema/constrained); o **validator determinístico** garante a SEMÂNTICA
(refs, DAG, tools existentes). O Planner **nunca** retorna plano inválido.

---

## Próximas fatias (planejadas)

- **Fatia 3 — Estado durável (resto da Fase 0):** `@clover/state` — event store
  append-only (JSONL puro-JS primeiro, para evitar dep nativa) + snapshots +
  projeções; `@clover/scheduler` durável com resume por checkpoint. *Risco: nenhum
  (puro JS).*
- **Fatia 4 — Segurança real (Fase 2):** `@clover/capability` (resolver dedicado +
  assinatura), `@clover/resource-manager`, `@clover/sandbox` (Tier 1 isolated-vm /
  Tier 2 WASM / Tier 3 processo). *Risco: builds nativos (`isolated-vm`/`wasmtime`)
  — validar disponibilidade no ambiente antes; degradar para Tier 3 se necessário.*
- **Fatia 5 — Cognição em escala:** `@clover/context-builder`, `@clover/tool-search`
  (descoberta semântica), `@clover/agent-runtime` (atores). Fecha Fase 3.
