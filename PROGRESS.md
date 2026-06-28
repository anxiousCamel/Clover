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

### Fatia 3 — Estado Durável (Event Store + Projeções + Replay) — ✅ CONCLUÍDA
Objetivo: tornar o **journal append-only a fonte da verdade** e reconstruir o estado
das tasks por replay (ADR-005). Fecha o núcleo da Fase 0 (resto das Fundações).

Pacote:
- [x] `@clover/state` — `EventStore` (in-memory + persistência **JSONL puro-JS**, com
      reload no "restart"), `SnapshotStore` (in-memory + disco), `recordBusToStore`
      (liga o Event Bus ao journal: observabilidade = durabilidade), `projectTasks`
      (reconstrói status/outputs/nós concluídos **só a partir do journal**).

**Verificação (executada):**
- `pnpm --filter @clover/state exec vitest run` → **5/5 testes verdes**: append/read
  ordenado; **persistência JSONL sobrevive a reabrir o arquivo**; snapshot round-trip
  (memória + disco); integração Kernel → journal → projeção (`done`, `["hello
  world"]`, nós `[n1,n2]`) **reconstruída por replay** (journal serializado e
  re-projetado do zero); projeção de task `failed`.
- Build completo do grafo (9 pacotes) → **exit 0**; suíte total **16/16** (kernel 5,
  planner 6, state 5).

**Fora desta fatia (registrado):** *resume por checkpoint* que **re-executa apenas os
nós restantes** exige cooperação do Executor (pular nós já concluídos lendo o
journal/snapshot). O spine de durabilidade/replay/projeção está provado; a
re-execução incremental entra junto com o `@clover/scheduler` durável.

---

### Fatia 4 — Scheduler Durável + Resume Incremental — ✅ CONCLUÍDA
Objetivo: substituir o fire-and-forget; toda task é persistida (com o próprio Plan IR)
e **resumível**, re-executando SOMENTE os nós restantes. Atende ao requisito de
"tarefas de horas/dias" + recovery após crash.

Mudanças:
- [x] `@clover/contracts` — novo evento `node:skipped` (observabilidade do resume).
- [x] `@clover/executor` — `run(plan, token, ctx, resume?)`: pré-semeia saídas de nós
      concluídos e **pula** esses nós (backward-compatible: chamadas de 3 args
      inalteradas).
- [x] `@clover/kernel` — `executePlan(plan, taskId, { resume })` (executa para um
      taskId dado, sem emitir `task:submitted`); `submitPlan` agora delega a ele.
- [x] `@clover/state` — `rebuildNodeOutputs(events, taskId)` e
      `findSubmittedPlan(events, taskId)` (recuperam saídas e o plano do journal).
- [x] `@clover/scheduler` — `DurableScheduler.submit` (persiste `task:submitted` COM o
      plano) e `.resume(taskId)` (recupera plano + saídas do journal e re-executa só o
      restante).

**Verificação (executada):**
- `pnpm --filter @clover/scheduler exec vitest run` → **3/3 verdes**:
  - resume incremental no mesmo processo (nó concluído **não** re-executa);
  - **crash recovery**: orquestrador 100% novo, com APENAS o journal em disco, retoma
    a task até `done` — `echo` re-executado **0 vezes** em B (saída veio do journal),
    só o nó restante rodou;
  - resume de task inexistente lança erro.
- Regressão completa: **19/19** (kernel 5, planner 6, state 5, scheduler 3); build de
  **10 pacotes** → exit 0.

---

### Fatia 5 — Capabilities assinadas + Resource Manager (núcleo da Fase 2) — ✅ CONCLUÍDA
Objetivo: fechar a lacuna de autorização (P4) com **tokens de menor privilégio
assinados** e adicionar o primitivo de **governança de recursos**. Caminho puro-JS
(`node:crypto`), sem risco de build nativo.

Pacotes/mudanças:
- [x] `@clover/capability` (novo) — `CapabilityResolver`: `mint` (deriva caps mínimas
      do Plan IR + caps de recurso declaradas por cada tool, **assina HMAC-SHA256**,
      time-boxed), `verify` (detecta adulteração de `caps` e expiração, compara em
      tempo constante) e `authorize`. Promovido do stub que vivia no kernel.
- [x] `@clover/resource-manager` (novo) — `Semaphore` (concorrência justa FIFO, slot
      transferido no release → sem sobre-subscrição), `withTimeout`/`TimeoutError`,
      `Budget`, e a fachada `ResourceManager.run()`.
- [x] `@clover/executor` — hook opcional `verifyToken`: token forjado/ampliado/expirado
      → plano falha com `capability_denied` antes de qualquer execução (defesa para
      tools fora do processo). Backward-compatible (sem hook = comportamento antigo).
- [x] `@clover/kernel` — passa a usar `@clover/capability` (mint com os descritores das
      tools; engine recebe o `verifyToken`).

**Verificação (executada):**
- `capability` **6/6** (menor privilégio; verify de token válido; **rejeita token
  adulterado**; rejeita expirado; rejeita assinatura com segredo errado; authorize só
  o concedido).
- `resource-manager` **6/6** (concorrência nunca excede o limite; release libera slot
  em erro; timeout; budget recusa estouro sem consumir; serialização sob
  `maxConcurrent=1`).
- Regressão completa: **31/31** (capability 6, resource-manager 6, kernel 5, planner 6,
  state 5, scheduler 3); build de **12 pacotes** → exit 0.

---

### Fatia 6 — Sandbox Tier 3 (processo endurecido) — ✅ CONCLUÍDA
Objetivo: corrigir o núcleo de P3 (exec-guard inseguro) com isolamento de processo
real, **sem dependência nativa**.

Pacote:
- [x] `@clover/sandbox` — `SandboxBackend` (interface para os 3 tiers) + `ProcessSandbox`
      (Tier 3): **argv sem shell** (sem injeção), **fronteira de workspace** por path
      canônico (bloqueia `..` e absoluto), **timeout + SIGKILL**, **env mínimo** (não
      herda o ambiente), **gate de capability** `proc.exec` (argv[0] na allowlist),
      e cap de buffer de saída (anti-OOM).

**Verificação (executada):** antes de codar, **probe confirmou** que `spawn` funciona
no ambiente (`child-ok`). Testes **5/5**: roda comando permitido e captura stdout;
**metacaracteres chegam literais (sem injeção)**; processo que estoura o timeout é
morto (`timedOut`, exitCode null); programa fora de `proc.exec` é negado; `cwd` fora do
workspace é bloqueado. Regressão completa: **36/36** (capability 6, resource-manager 6,
sandbox 5, kernel 5, planner 6, state 5, scheduler 3); build de **13 pacotes** → exit 0.

**Decisão (registrada):** Tiers 1 (`isolated-vm`) e 2 (WASM/`wasmtime`) **adiados** —
exigem build nativo. NÃO tentei instalar agora: o Tier 3 é um entregável completo e não
compromete a integridade, então não há motivo para Yield; um build nativo lento/falho
só desperdiçaria ciclos. A validação do `isolated-vm`/`wasmtime` (com Yield se falhar)
é um passo deliberado da próxima fatia de sandbox. Limites finos de CPU/RAM dependem
desses tiers (cgroups/fuel); o Tier 3 entrega timeout de parede + isolamento de
processo.

---

## Estado consolidado (Fases 0–2)

| Fase | Cobertura entregue |
|---|---|
| **0 — Fundações** | Event Bus (`event-bus`), Event Store + projeções + replay (`state`), Scheduler durável + resume (`scheduler`). ✅ núcleo |
| **1 — IR + Determinismo** | Plan IR + validator (`ir`), IR VM / DAG runner (`executor`), Planner sob constrained decoding (`planner` + `llm`). ✅ núcleo |
| **2 — Segurança** | Capabilities assinadas (`capability`), Resource Manager (`resource-manager`), Sandbox Tier 3 (`sandbox`). ✅ núcleo; Tiers 1/2 (nativo) e wire do RM no Scheduler pendentes |

**13 pacotes · 36 testes verdes · `tsc --build` exit 0.**

## Próximas fatias (planejadas)

- **Fatia 7 — Cognição em escala (Fase 3):** `@clover/context-builder` (montagem de
  contexto sob orçamento de tokens), `@clover/tool-search` (descoberta semântica de
  tools), `@clover/agent-runtime` (atores). Puro JS → sem risco.
- **Fatia 8 — Sandbox nativo + wiring:** Tier 1 `isolated-vm`, Tier 2 WASM; wire do
  `ResourceManager` no Scheduler (concorrência/timeout por task). *Risco: build
  nativo — validar e fazer Yield se indisponível.*
