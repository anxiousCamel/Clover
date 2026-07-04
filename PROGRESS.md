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

### Fatia 7 — Cognição em escala (Fase 3) — ✅ CONCLUÍDA
Objetivo: viabilizar "centenas de agentes / milhares de tools" sem inundar o contexto
de modelos pequenos. Puro JS.

Pacotes:
- [x] `@clover/tool-search` — `ToolSearch` + `LexicalToolSearch` (scorer determinístico
      por overlap de termos, bônus para casamento no nome; pluggable para embeddings).
- [x] `@clover/context-builder` — `ContextBuilder.build` monta o contexto sob
      **orçamento de tokens** por prioridade (system → consulta → tools relevantes →
      histórico recente → memória), descarta o que não cabe (`dropped`), registra
      **proveniência** e usa o Tool Search para trazer só tools relevantes.
- [x] `@clover/agent-runtime` — `ActorSystem`/`Actor`: mailbox **sequencial**, estado
      **isolado** por ator, `ctx.send` entre atores, erros propagados só ao remetente.

**Verificação (executada):** tool-search **4/4**, context-builder **4/4** (nunca excede
o orçamento; system+consulta sempre presentes; seleção de tools via search; descarte sob
orçamento apertado; proveniência), agent-runtime **5/5** (ordem sequencial sob atrasos
variáveis; isolamento; comunicação entre atores; ator desconhecido; erro não derruba o
ator). Regressão completa: **49/49** em 10 suítes; build de **16 pacotes** → exit 0.

### Fatia 8 — Wiring ponta-a-ponta (Agent) — ✅ CONCLUÍDA
Objetivo: o fluxo "respirando" de uma meta até o resultado executado/persistido,
comprovando isolamento do Actor Model e sincronia do Event Bus.

Pacote/mudanças:
- [x] `@clover/agent` (novo) — `Agent.run(goal)`: **ContextBuilder** (Tool Search
      seleciona só as tools relevantes) → **Planner** (LLM→IR usando apenas as tools
      selecionadas) → **ResourceManager.run(Scheduler.submit)** (execução durável,
      concorrência limitada, eventos no bus → journal).
- [x] `@clover/kernel` — `listTools()` (catálogo de descritores p/ Context/Search).
- [x] `@clover/llm` — `MockProvider` aceita um responder `(req) => string` (mocks
      dinâmicos, ex.: plano derivado da meta).

**Verificação (executada):** `@clover/agent` **2/2**:
- fluxo único: meta → contexto (tool `work` selecionada via Tool Search) → plano →
  execução durável → `["work task alpha"]`, task `done` no journal;
- **N metas como atores isolados**: 5 metas disparadas em paralelo via `ActorSystem`,
  cada ator devolve o resultado **da sua própria meta** (sem cross-talk = isolamento),
  o `ResourceManager` mantém o **pico de concorrência ≤ 2** (governança) e o **único
  Event Bus** alimenta o journal que reconstrói **5 tasks independentes** (sincronia).
- Regressão completa: **51/51** em 11 suítes; build de **17 pacotes** → exit 0.

---

### Fatia 10 — Conhecimento: AST Index + Knowledge Graph (Fase 4) — ✅ CONCLUÍDA
Objetivo: operar sobre **estrutura** (AST) em vez de texto cru e ter um **grafo de
conhecimento** consultável — a espinha dorsal para não afogar o LLM com tokens.

Pacotes:
- [x] `@clover/ast-index` — `AstParser` (interface plugável) + `TypeScriptAstParser`
      (via **TS Compiler API**, zero dep nativa) extraindo símbolos
      (function/class/method/interface/type/enum/variable, com `exported` e
      `container`) e imports (default/namespace/named); `AstIndex` com outline,
      `findSymbol`, reindexação.
- [x] `@clover/knowledge-graph` — grafo embarcado (adjacência + persistência JSONL com
      reload) — `upsertNode/Edge`, `neighbors` (por relação/direção), `edgesOf`; e
      `buildGraphFromIndex` que **deriva o KG do AST** (nós file/symbol/module; arestas
      contains/has-member/imports).

**Decisão pragmática (registrada):** o backend de AST default é a **TS Compiler API**,
não `tree-sitter` nativo. Motivo: o `tree-sitter` nativo carrega o **mesmo risco de
build nativo** dos Tiers 1/2 de sandbox (postergados); a TS Compiler API já está
instalada (zero dep nova, zero risco) e cobre TS/JS/TSX/JSX — as linguagens do próprio
monorepo. Um `TreeSitterAstParser` multi-linguagem (gramáticas WASM) entra **atrás da
mesma interface `AstParser`** sem mudar o índice nem o KG — é o mesmo padrão de
pragmatismo já validado. Probe confirmou a TS Compiler API disponível (`ts 5.9.3`).

**Verificação (executada):** ast-index **4/4** (kinds + export + container de métodos;
imports default/namespace/named; ignora não suportados + reindexa; linha 1-based),
knowledge-graph **3/3** (nós/arestas + `neighbors` por relação/direção; **persistência
JSONL com reload**; **KG derivado do AST** com contains/has-member/imports). Regressão
completa: **58/58** em 13 suítes; build de **19 pacotes** → exit 0.

---

---

## Mandato de Execução Contínua — REPL Avançado + Embalagem DX — ✅ CONCLUÍDO

Executado de ponta a ponta, sem yields parciais.

### Escopo 0 — `@clover/blackboard` (pré-requisito)
Cognição compartilhada event-sourced (post/query/subscribe, versão por tópico,
persistência JSONL, `stats()`). Necessário para `/status` e a resiliência. **5/5**.

### Escopo 1 — Cognição integrada (KG+AST → contexto → planner)
- `@clover/knowledge-retriever` (ranqueia símbolos AST + membros do KG em snippets
  estruturais); `context-builder` expõe `selectedMemory`; `planner.plan(.., {contextText})`;
  `agent` recupera → alimenta o contexto **sob orçamento rígido** antes de planejar.
- Verificação: o contexto estrutural chega ao prompt do Planner **e** é cortado quando
  o orçamento aperta. **knowledge-retriever 3/3 · agent 4/4**.

### Escopo 2 — REPL avançado (`@clover/tui` + `apps/cli`)
- `@clover/tui` (**18/18**): tema Clover centralizado (cores/símbolos) com **fallback**
  sem-cor (NO_COLOR/não-TTY) e ASCII (não-UTF-8/`CLOVER_ASCII`); parser de `/comandos`;
  interceptação de arquivos/imagens em **tags limpas**; contador de tokens; `decodeKey`
  + `ChoicePrompt` (raw-key, **sem vazar tecla**) + `StatusBoard` multi-ator.
- `apps/cli` (**17/17** de lógica): REPL chat-loop; `/help /model /status /clear /exit`;
  `/exec` no **Sandbox Tier 3** com **confirmação contextual em raw mode**; spinner vivo
  com raciocínio dinâmico (anti-freeze) + nº de atores + tokens.

### Escopo 3 — Instalação + tema + resiliência + manual
- **`clover setup`** idempotente (Node/pnpm/node_modules/build/Ollama/modelo), faz só o
  que falta; `--check` diagnostica sem agir. **4/4**.
- **Tema centralizado** em `@clover/tui` (sem cores hardcoded espalhadas) + fallback.
- **Resiliência catastrófica**: `uncaughtException`/`unhandledRejection` → persiste no
  **Blackboard** → saída polida, **nunca stack cru**. **3/3**.
- **README.md** Tier-1 (quickstart copy/paste + guia do REPL) + scripts raiz
  (`pnpm clover`, `clover:setup`, `build:os`).

**Smoke:** `clover --help` e `clover setup --check` rodam; fallback ASCII/sem-cor ativo
sob pipe (mostra `*`/`[ok]`).

---

## Mandato de Execução Contínua — Produto, Autonomia e Ecossistema Aberto — ✅ CONCLUÍDO (Fase de Produto e UX)

Executado de ponta a ponta, sem yields, sem quebrar testes anteriores.

### Escopo 1 — i18n + `/config`
- `@clover/config` (**5/5**): config global em `~/.cloveros/config.json` (dir 0700,
  arquivo **0600**) — idioma/modelo/logLevel/modo/provedores; merge com defaults.
- `@clover/i18n` (**5/5**): dicionários **EN + PT-BR** + `t(key,vars)`; idioma vem da
  config. Strings do CLI movidas para o dicionário (PT-BR preservado → sem quebra).
- `/config`: painel interativo em **raw mode** (setas) p/ idioma, modelo, log e modo.

### Escopo 2 — Modos de Autonomia (`/mode`)
- `/mode step` (padrão): confirmação contextual por teclado p/ ações Tier 3.
- `/mode auto`: sem confirmações; confia nas **barreiras programáticas** (orçamento,
  `maxTurns`, timeout). Ao bater o teto → **suspende a task, salva no Blackboard,
  notifica no REPL**. Roteamento `step`×`auto` coberto por testes (**cli 21/21**).

### Escopo 3 — Provedores de nuvem + credenciais seguras
- `@clover/llm` `OpenAiCompatibleAdapter` (**4/4**): ponte universal
  (OpenRouter/Groq/DeepSeek/OpenAI); structured outputs via `json_schema` quando
  suportado, **degradação graciosa** p/ `json_object` + schema no prompt; `fetch`
  injetável.
- `/provider`: adiciona provedor com **API Key mascarada** (raw mode, `*` — não vaza)
  salva em `~/.cloveros/config.json` (0600). O Agent lê o provedor **dinamicamente**.

### Restrições atendidas
- Tema **Clover 🍀** mantido em todos os menus novos.
- Interceptação de caminhos de arquivo/imagem **preservada** (teste de regressão).
- Testes do `OpenAiCompatibleAdapter` e do roteamento de modos adicionados.
- README atualizado (guia do REPL + setup OpenRouter/OpenAI/Groq/DeepSeek).

---

## Estado consolidado (Fases 0–4 + Produto/UX) — FASE DE PRODUTO E UX CONCLUÍDA

| Fase | Cobertura entregue |
|---|---|
| **0 — Fundações** | `event-bus`, `state` (event store + replay), `scheduler` (durável + resume), `blackboard`. ✅ |
| **1 — IR + Determinismo** | `ir`, `executor`, `planner` + `llm` (constrained decoding; **+ OpenAI-compatible**). ✅ |
| **2 — Segurança** | `capability` (assinada), `resource-manager`, `sandbox` Tier 3. ✅ núcleo; Tiers 1/2 nativos **no backlog** |
| **3 — Cognição em escala** | `tool-search`, `context-builder`, `agent-runtime`. ✅ |
| **4 — Conhecimento** | `ast-index`, `knowledge-graph`, `knowledge-retriever`. ✅ núcleo; tree-sitter multi-lang no backlog |
| **Wiring** | `@clover/agent` (Context → Planner → Scheduler/RM, com retrieval estrutural). ✅ |
| **DX / Produto** | `@clover/tui` + `apps/cli` (REPL, setup, resiliência, tema). ✅ |
| **Produto / UX** | `@clover/config` + `@clover/i18n` + `/config`/`/mode`/`/provider` + provedores de nuvem. ✅ |

**24 pacotes + `apps/cli` · 121 testes verdes (20 suítes) · `tsc --build` exit 0.**

---

## Fatia Arsenal #1 — `@clover/tools` + Departamento Git (leitura) — ✅ CONCLUÍDA

**Contexto:** o tool layer era o walking skeleton (3 tools puras: `echo`/`concat`/
`respond`). Esta fatia inicia o **arsenal real** por departamentos, provando o
padrão ponta-a-ponta com o namespace `git/` — a fatia vertical mais segura e
determinística para estabelecer o contrato que os demais departamentos copiam.

**Decisão de escopo:** implementar **um namespace inteiro e real** (Zod, Sandbox,
testes, registro) em vez de esboçar 21 departamentos fictícios. Departamentos
seguintes seguem por fatias verticais (ver `TOOLS.md`).

Entregue (`packages/tools/`):
- [x] `src/abi.ts` — `defineZodTool`: ponte **Zod → Tool ABI** (JSON Schema enxuto
      derivado + validação de entrada/saída em runtime). O construtor canônico de
      toda tool do arsenal.
- [x] `src/sys/exec.ts` — `runBinary`/`detectBinary`: primitiva única de execução,
      **sempre via Sandbox Tier 3** (zero `child_process` nas tools). Flag
      `truncated` (corte em `maxBuffer`) + detecção graciosa de binário/versão.
- [x] `src/git/` — 7 tools de leitura: `git_status`, `git_current_branch`,
      `git_log`, `git_diff`, `git_branch_list`, `git_show_file`, `git_blame`.
      Parsers puros sobre formatos à prova de máquina (`--porcelain=v2 -z`,
      `%x1f`/NUL, `--name-status -z`, `--line-porcelain`). Refs/pathspecs
      sanitizados contra injeção de opção; pathspec após `--`.
- [x] Registro: `createKernel([...demoTools, ...cloverTools])` em `apps/cli` —
      torna as 7 tools visíveis ao Planner + Context Builder (via
      `kernel.listTools()`), sem tocar Kernel/Executor/Capability.

**Verificação (executada):**
- `pnpm --filter @clover/tools run test` → **25/25 verdes** (4 suítes: parsers
  puros, ABI Zod, integração real contra repo git temporário incl. spawn win32,
  e **e2e `submitPlan`** — token cunhado pelo Kernel → gate → Sandbox).
- `pnpm run build:os` (`tsc --build apps/cli`) → **exit 0** (grafo inteiro).
- Smoke: `kernel.listTools()` lista as 7 `git_*` + as 3 base; `submitPlan` de um
  plano `git_status` retorna `status: done`, `branch: main`.

**Follow-ups honestos (não silenciados):**
- **ResourceManager fora do caminho de exec.** Hoje: `tool → runBinary → Sandbox`.
  O Executor invoca `bridge.invoke` direto; o RM (concorrência/timeout/orçamento)
  ainda não envelopa a execução da tool. Integrá-lo como envelope é o próximo
  item de segurança/observabilidade.
- **Git de escrita** (`commit/add/merge/rebase/cherry-pick/stash`) e **PR** (`gh`)
  ficam para a próxima fatia git, com confirmação no modo `step`.

**Total: 25 pacotes + `apps/cli`.** Esta fatia adiciona 25 testes (4 suítes),
todos verdes, e `tsc --build` exit 0.

> **Nota de ambiente (resolvida na fatia seguinte):** `pnpm run test:os` tinha
> 1 falha pré-existente em `@clover/config` (0600 no Windows). Corrigida com
> guard `if (process.platform !== 'win32')` no teste — o código já fazia
> best-effort (`chmodSync` silenciado). Todos os testes verdes após a correção.

---

## Fatia Arsenal #2 — Governor Integration + fs/dev Tools + Win32 0600 Fix — ✅ CONCLUÍDA

**Contexto:** a fatia anterior deixou 3 follow-ups: (a) RM fora do caminho de exec
de tools, (b) fs/dev como namespaces sem testes de integração, (c) 0600 falhando no
Windows. Esta fatia fecha os 3.

**O que foi descoberto ao auditar o estado real (antes de codar):**
- `ExecutionGovernor` já estava implementado em `@clover/resource-manager` e já
  conectado ao CLI via `authorize`/`guard` no `createKernel` do `apps/cli/main.ts`.
- `fs/` (`read_file_paginated`, `write_file`, `patch_file`) e `dev/` (`search_code`)
  já existiam com implementação completa — escritas via `sys/fs` (chokepoint único).
- 0600: o guard `if (process.platform !== 'win32')` já estava no teste.
- **O que realmente faltava:** testes do `ExecutionGovernor` (o RM testava só
  `Semaphore`/`Budget`/`ResourceManager`) e teste e2e do Governor interceptando
  write tools pelo Executor.

**Nota de design (corrige uma premissa do mandato):**
`write_file`/`patch_file` usam `sys/fs` (node:fs direto), **não o Sandbox Tier 3**.
O chokepoint correto é o **Executor** (ele vê `intent` de cada tool); mover a trava
para o Sandbox deixaria essas tools desprotegidas. O teste e2e prova exatamente isso.

Entregue:
- [x] `packages/resource-manager/test/resource-manager.test.ts` — **10 novos testes**
      de `ExecutionGovernor`: read passa sem audit; write no step sem prompt → denied
      (fail-safe); prompt false → denied + audit; prompt true → allowed + audit; auto
      → allowed + audit; contexto/clock injetados na AuditEntry; prompt assíncrono
      awaited; guard timeout; guard passthrough; guard sem timeout transparente.
- [x] `packages/tools/test/fs-governor-e2e.test.ts` — **7 testes e2e** de
      autorização via Kernel (o mesmo fluxo do REPL): `write_file` sem Governor →
      `authorization_denied` (fail-safe, arquivo não criado); com Governor auto →
      `done` + arquivo em disco; com Governor step nega → `authorization_denied`;
      com Governor step aprova → `done`; `patch_file` sem Governor → denied + arquivo
      intacto; com auto → done + conteúdo atualizado; `read_file_paginated` (read) →
      NÃO chama `authorize` (não aparece no audit).
- [x] `TOOLS.md` — adicionadas seções para `fs/` (3 tools) e `dev/` (search_code),
      invariantes de segurança 5 (Governor obrigatório para writes) e 6 (chokepoint
      sys/fs vs Sandbox).

**Verificação (executada, win32):**
- `@clover/resource-manager` → **16/16** (6 originais + 10 Governor). ✅
- `@clover/tools` → **32/32** (25 originais + 7 fs-governor-e2e). ✅
- `@clover/config` → **5/5** (incluindo o teste 0600 com guard win32). ✅

**Total acumulado: 25 pacotes + `apps/cli`.** Esta fatia adiciona 17 testes (2
suítes), todos verdes no win32.

---

## Fatia Arsenal #3 — Git Write V2 + Build & QA + Auto-Heal + Auto-Rollback

**Contexto:** Arsenal #2 conectou o Governor ao path de execução de tools e entregou
`fs/` e `dev/search_code`. Esta fatia fecha o loop de engenharia autônoma: o Agente
agora pode **commitar, ramificar, reverter, restaurar, buildar, testar e se recuperar
automaticamente de falhas de compilação**.

**Correção arquitetural incluída:** o `runWithHeal` original apenas desistia na última
tentativa, deixando a working tree com estado quebrado. A correção garante que, ao
esgotar as tentativas, o Agente aciona automaticamente `git_restore -- .` para
descartar todas as mudanças feitas durante a tarefa — o repositório volta ao estado
seguro original antes de retornar.

### Ação 1 — Operações de Escrita Git (Arsenal #3)

Namespace `git/` — 4 novas tools de escrita/destrutiva, todas com Zod, Sandbox Tier 3,
`assertSafeRef` e cobertura de testes de integração real:

- [x] **`git_commit`** (intent `write`) — `git add -A` (stageAll) + `git commit -m`;
      suporta `authorName`/`authorEmail` via flags globais `-c` antes do subcomando.
- [x] **`git_checkout_branch`** (intent `write`) — `git checkout [-b] <name>`;
      isola refatorações perigosas em branch antes de executar.
- [x] **`git_restore`** (intent `destructive`) — `git restore [--staged] -- <paths>`;
      rollback automático no loop de auto-cura.
- [x] **`git_revert`** (intent `write`) — `git revert --no-edit <commit>`;
      desfaz commit anterior sem perder histórico.

### Ação 2 — Build & QA (`run_build_and_test`)

Namespace `dev/` — nova tool de build/teste multiplataforma:

- [x] **`run_build_and_test`** (intent `read`, 4 caps proc.exec) — detecta engine por
      arquivo de lock; roda build e/ou teste via Sandbox; `success=false + stderr`
      legível alimenta o loop de auto-cura do Agente.
- [x] **`detectBuildEngine`** — pnpm-lock.yaml → yarn.lock → package-lock.json →
      Cargo.toml → package.json → pnpm (fallback).

### Ação 3 — Loop de Auto-Cura (`Agent.runWithHeal`)

- [x] **`Agent.runWithHeal(goal, opts)`** — laço de retry: detecta output
      `run_build_and_test` com `success=false`, injeta `stderr` no goal para re-planejar.
- [x] **`HealOptions.onFinalFailure`** — callback injetável (para testes); sem callback,
      usa `defaultRollback` (chama `git_restore -- .` com token sintético).
- [x] **`extractBuildFailure(result)`** — duck-typing sobre `result.outputs`; funciona
      para qualquer tool com `{ success: false, stderr, failedCommand }`.

### Verificação (executada, win32)

- `@clover/tools` → **50/50** (7 suítes: git-parse, abi, build-qa 13/13, fs-governor-e2e,
  git-e2e, git-tools, **git-write 9/9**; 4 skipped por ausência de npm real). ✅
- `@clover/agent` → **11/11** (agent-heal **7/7** + agent.e2e **4/4**). ✅
  - heal tests: sem falha → 1 plano; fail→sucesso → 2 planos; re-plano contém stderr;
    maxAttempts=1 sem retry; stderr legível; **rollback acionado** na falha final;
    sucesso **não** aciona rollback.

**Total acumulado: 25 pacotes + `apps/cli`.** Esta fatia adiciona 15 novos testes
(git-write 9, build-qa 9 unitários/integração, agent-heal 7; subtraindo os 5 originais
do heal = 10 net novos de heal), `tsc --build` exit 0.

---

## Fatia — Mandato "Inteligência Absoluta" (Fable 5): profundidade sobre largura

**Contexto:** o mandato pede ~80+ tools em 6 departamentos (Knowledge Base SQLite,
AST/Language Server, Workspace Index, Research, Binary/PCAP internals, Planning), cada
uma "real, não-stub, com testes, `tsc --build` e `pnpm run test` exit 0".

**Decisão (profundidade sobre largura):** as restrições do próprio mandato — *"não
produzir stubs"*, *"implementação real"*, *"possuir testes unitários"*, *"testes exit
0"* — são **mutuamente exclusivas** com entregar 80+ tools num único turno. Largura em
um turno violaria exatamente as restrições declaradas. Logo, *execução contínua* =
enviar fatias **completas + verdes**, uma de cada vez, não tudo de uma vez como stub.
Esta fatia entrega FASE 0 (robustez FS/auto-cura) + o núcleo real da FASE 2 (AST), com
o restante honestamente marcado como planejado.

### FASE 0 — Robustez FS + auto-cura (auditoria)

- [x] **`patch_file` cria backup `.bak`** obrigatório do conteúdo original antes de
      sobrescrever — só *após* o check de "trecho encontrado" (patch malsucedido não
      deixa `.bak` espúrio). Novo campo `backup` na saída Zod. `write_file` já criava
      diretórios pais recursivamente (mantido; backup é só do `patch_file`, como o
      mandato exige). → `test/fs-patch.test.ts` (4 testes).
- [x] **Rollback real do `runWithHeal` provado.** Os testes de `agent-heal` só provavam
      o hook `onFinalFailure` (mock injetado). Adicionado teste do caminho **default**
      (`defaultRollback` → `gitRestoreTool` → `git restore -- .`) contra repo git real
      com working tree suja, provando o descarte de fato. → `test/agent-rollback-real.test.ts`.
      **Limitação conhecida documentada:** `git restore` reverte arquivos rastreados mas
      não remove *untracked* criados por uma tentativa falha (precisaria de `git clean`).

### FASE 2 — Departamento AST (núcleo real, sintático)

- [x] **`ast/parse.ts`** — motor puro via TS Compiler API (`ts.createSourceFile`), SRP
      (só AST, sem I/O nem Zod). Determinístico. Extrai imports (4 formas), exports (5
      formas), classes (herança/implements/abstract/decorators/membros), interfaces,
      funções (decl + arrow, async, params), variáveis, enums, type aliases, decorators.
- [x] **4 tools** (`ast/index.ts`) — `analyze_module`, `query_ast_symbol`,
      `find_inheritance` (grafo extends/implements, reusa `analyzeSource`),
      `find_documentation` (JSDoc via `getLeadingCommentRanges`). Todas Zod in/out,
      `fs.read`, `read` intent, nunca lançam (wrapper ABI → `{ success:false }`).
      Registradas em `cloverTools`. `typescript` promovido a dependência de runtime.
      → `test/ast.test.ts` (20 testes).

**Escopo honesto (não é stub, mas tem fronteira declarada):** a análise é
**single-file e sintática** — sem `Program`/`TypeChecker`/`tsconfig`. Portanto
`find_references`, `find_type_definition`, `rename_symbol`, callers/callees e resolução
cross-file **não** estão implementados: exigem o Workspace Index (FASE 2.5) + TypeChecker,
que é a próxima fatia lógica. O que existe resolve o que está *escrito* no arquivo.
Cobertura atual do departamento AST: **4 de ~10** tools da FASE 2 (as sintáticas single-file).

### Gaps de contrato documentados (não silenciosamente pulados)

Os "requisitos arquiteturais globais" do mandato pedem **AbortSignal**, **timeout
configurável** e **emissão de métricas** por tool. O contrato real `ToolInvocation`
(`@clover/contracts`) hoje **não** carrega `signal`/`timeout` — as tools que executam
processos dependem do timeout do Sandbox Tier 3. Adicioná-los a *toda* tool é uma
mudança **transversal** (Executor + Scheduler + construção do ctx + cada tool) e foi
deliberadamente deixada como fatia própria, para não fazer um refactor de contrato
pela metade. As novas tools seguem o padrão **real** do código (Zod in/out, capability,
resultado estruturado sem-throw, testes), não um contrato divergente.

### Verificação (executada, win32)

- `@clover/tools` → **74 passed / 4 skipped** (9 suítes; +`fs-patch` 4, +`ast` 20). ✅
- `@clover/agent` → **13 passed** (+`agent-rollback-real` 2 real-git). ✅
- `build:os` (`tsc --build apps/cli/tsconfig.json`) → **exit 0**. ✅
- **Nota:** o `tsc --build` do repositório **inteiro** (`pnpm run typecheck`) está
  vermelho por erros **pré-existentes** em `apps/backend` (app legado fora do grafo do
  CloverOS — ex.: `sql.js` sem `@types`, `Config` cast). Não introduzidos por esta
  fatia (git estava limpo no início) e fora do escopo do mandato (`packages/*` + `cli`).

---

## Fatia — FASE 2.5: Workspace Index + Rollback Total — ✅ CONCLUÍDA

**Mandato:** (1) rollback 100% (`git clean -fd` após `git restore`); (2) índice
persistente/incremental do workspace em `packages/tools/src/index/` (SQLite), com
`workspace_index` exposto e `find_references`/`rename_symbol` consultando o índice.

### Ação 1 — Rollback Total (correção de curso)

- [x] **`git_clean`** (intent `destructive`) — `git clean -fd` (`-fdn` em `dryRun`);
      parseia `Removing <path>`/`Would remove <path>` → `removed[]`. Respeita
      `.gitignore` (não toca `node_modules` etc.). **Atenção documentada:** remove
      TODOS os untracked da tree, não só os de uma tentativa.
- [x] **`defaultRollback` agora é total:** `git restore -- .` (tracked) + `git clean
      -fd` (untracked), SÓ no caminho de falha final (nunca entre tentativas — uma
      tentativa seguinte poderia legitimamente reusar artefatos).
      → teste real-git estendido: arquivo tracked revertido **e** untracked removido.

### Ação 2 — Workspace Index (`packages/tools/src/index/`)

- [x] **Persistência:** `WorkspaceIndexStore` (store.ts) — SQLite via **sql.js** (WASM,
      zero build nativo; better-sqlite3 NÃO está instalado no repo — sql.js é o motor
      SQLite já validado pelo backend). In-memory + `export()` → `.clover/index.db`
      (gitignored via `*.db`). Schema: `files(path,mtime,size)`, `symbols`, `imports`,
      4 índices. `upsertFile` atômico por path (delete+insert). **`ORDER BY` em toda
      consulta** (determinismo — ordem de linha SQLite é indefinida sem ele).
      Declaração ambiente `sql-js.d.ts` mínima (não há `@types/sql.js`).
      Risco de integração de-riscado ANTES do resto: sql.js provado sob vitest
      (init WASM + round-trip em disco) em `test/index-store.test.ts`.
- [x] **Incremental (trigger):** `refreshIndex` (indexer.ts) — walk iterativo, skip
      `.git/node_modules/dist/.clover/coverage`, reparse **só** se `mtime`+`size`
      mudaram (verificação de mtime, como o mandato permite — watcher persistente não
      faz sentido em tools de vida curta); deletados removidos do índice. Extração
      reusa `TypeScriptAstParser` do `@clover/ast-index` (DRY — parser já existente).
- [x] **Tools registradas (3):**
      `workspace_index` — constrói/atualiza o índice, reporta indexed/skipped/removed
      + stats; `find_references` — definições + sites de import por nome, via índice
      (zero rescan de AST); `rename_symbol` — **dry-run/preview**: lista sites que
      mudariam e `applied: false` SEMPRE.
      → `test/index-workspace.test.ts` (6 testes: stats, incremental skip-total,
      reindex só do alterado + remoção do deletado, refs def+import, found=false,
      preview sem tocar arquivo).

### Decisões de escopo (Zero Ficção)

1. **`rename_symbol` não aplica** — rename seguro exige resolução semântica de binding
   (TypeChecker/Program). Aplicar por match de nome corromperia homônimos não
   relacionados (ex.: dois `run` em classes diferentes). Preview honesto > escrita
   perigosa fingindo ser segura. Aplicação entra quando houver camada semântica.
2. **`find_references` é name-based** — definições + imports pelo identificador
   (documentado na descrição da tool; o Planner vê a limitação).
3. **Rotas HTTP/modelos ORM adiados** — não há framework HTTP/ORM no workspace para
   validar contra código real; implementar padrão-matching às cegas seria ficção.
4. **Exceção ao invariante #6 documentada** — tools `read` que gravam só o *cache*
   `.clover/index.db` (não código do usuário) não passam pelo Governor.

### Verificação (executada, win32)

- `@clover/tools` → **86 passed / 4 skipped** (11 suítes; +`index-store` 5,
  +`index-workspace` 6, +`git_clean` 1). ✅
- `@clover/agent` → **13 passed** (rollback total real-git: tracked revertido +
  untracked removido). ✅
- `build:os` → **exit 0** (com `sql.js` + `@clover/ast-index` como novas deps de
  `@clover/tools`; referência de projeto adicionada ao tsconfig). ✅
- Registro: **24 tools** em `cloverTools` (era 21).

---

## Fatia — FASE 4.5: Code Intelligence Department — ✅ CONCLUÍDA

**Mandato recebido:** FASES 3 + 4 + 4.5 + 5 (~60 tools). **Decisão (mesmo critério
aprovado nas fatias anteriores):** profundidade sobre largura — FASE 4.5 primeiro por
ser a continuação natural do Workspace Index (2.5) e 100% verificável offline.

### Fundação (aditiva, sem quebra de ABI)

- [x] **`@clover/ast-index`**: `AstSymbol.endLine?` (opcional) — span da declaração,
      base das métricas de tamanho. Testes existentes passam sem mudança.
- [x] **Store schema v2**: coluna `end_line` + `PRAGMA user_version`; em mismatch de
      versão, drop+recreate — o índice é CACHE reconstruível (fonte da verdade = código
      no disco), migração = reindexar. Novas queries (`allImports`, `exportedSymbols`,
      `symbolsByKinds`), todas com `ORDER BY`.

### Motores puros (SRP)

- [x] **`intelligence/graph.ts`** — resolução de import relativo (`./x.js` ESM →
      `x.ts` no disco, extensões implícitas, `index.*`), grafo interno vs externos,
      ciclos via DFS com canonicalização (rotação p/ menor nó) e dedup, deps
      diretas/reversas. Zero I/O.
- [x] **`intelligence/scan.ts`** — marcadores (reusa `walkSearch` do dev/ — DRY),
      `process.env` (2 formas), manifests package.json (main/bin/scripts), configs por
      convenção, regexes de teste/entrypoint compartilhadas.

### 15 tools registradas (total: 39)

find_todos, find_fixmes, find_cycles, find_dependencies, find_reverse_dependencies,
find_unused_exports, find_unused_files, find_large_functions, find_large_classes,
find_test_files, find_entrypoints, find_configurations, find_build_scripts,
find_environment_variables, summarize_project_architecture.
→ `test/intelligence.test.ts` (14 testes, fixture real: ciclo a→b→c→a, órfão, export
morto, função de 60 linhas, env vars, manifests).

### Decisões de escopo (Zero Ficção — por fase do mandato)

1. **FASE 4 (internals/) BLOQUEADA por evidência:** verificado nesta máquina —
   `tshark`, `tcpdump`, `ilspycmd`, `dumpbin`, `objdump`, `nm`, `7z` **ausentes**
   (só `unzip` presente). Wrappers Sandbox sem binário real para testar = ficção.
   Entra quando o ambiente tiver as ferramentas (ou como parser PE/ELF puro-JS,
   fatia própria).
2. **FASE 3 (research/) próxima fatia:** tools de rede exigem design de fetcher
   injetável para testes determinísticos (precedente: OllamaProvider atrás do port).
   Não começada aqui para não entregar metade sem testes.
3. **FASE 5 (planning/) parcialmente coberta:** `impact_analysis`/`dependency_analysis`
   do mandato = `find_reverse_dependencies`/`find_dependencies`/`find_cycles` desta
   fatia. O restante (build_execution_plan, task_decomposition...) é papel do
   **Planner LLM** (ADR-004), não de tool determinística — versões heurísticas
   determinísticas seriam rasas o suficiente para violar "implementação real".
4. **Tools da FASE 4.5 omitidas (com motivo):** find_callers/callees (call-graph =
   semântico, exige TypeChecker); find_http_routes/middlewares/database_models/
   event_handlers/message_consumers (nenhum framework no workspace p/ validar);
   find_duplicate_code/similar_code (similaridade real = fatia própria);
   find_architecture_violations/service_boundaries (exigem config de regras);
   find_security/performance_hotspots (heurísticas rasas = ficção);
   find_feature_flags (nenhum sistema de flags no workspace);
   find_public/private_api ⊂ `exportedSymbols` (já exposto via unused_exports).

### Verificação (executada, win32)

- `@clover/tools` → **100 passed / 4 skipped** (12 suítes; +`intelligence` 14). ✅
- `@clover/agent` → **13 passed**; `@clover/ast-index` → **4 passed**. ✅
- `build:os` → **exit 0**. Registro: **39 tools**.

---

## Backlog técnico (postergado, sem bloqueio)

- **Fatia 9 — Sandbox nativo:** Tier 1 `isolated-vm`, Tier 2 WASM (limites finos de
  CPU/RAM). O Tier 3 atende o isolamento da POC.
- **AST multi-linguagem:** `TreeSitterAstParser` (gramáticas WASM) atrás de `AstParser`.
- **Cache semântico de embeddings** (Fase 4).
- **Confirmação destrutiva no fluxo do agente** (atual: `/exec` já usa raw-mode +
  Tier 3; estender o gate a tools de escrita quando existirem).
