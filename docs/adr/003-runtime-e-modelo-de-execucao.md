# ADR 003: Runtime e Modelo de Execução (Sandbox em Camadas)

- **Status:** Aceito (proposta CloverOS)
- **Data:** 2026-06-28
- **Relacionado:** [RAP §5.2, §10](../architecture/cloveros-rap.md)

## Contexto

O `exec-guard` atual oferece apenas deny-list por regex + checagem de workspace +
timeout `SIGKILL`. Não há limite de CPU/RAM, há superfície de **shell injection**,
**escape por path absoluto**, e comandos perigosos (`sudo`, `curl`) não são barrados.
Para tratar o Clover como um "OS de agentes" que executa trabalho não-confiável
(planos autorados por LLM, plugins de terceiros, múltiplas linguagens), isso é
inaceitável.

Restrição de produto confirmada: **manter Node/TS**, sem migrar o runtime do host
para Deno e sem reescrever um sandbox nativo em Rust/Go. O desempenho **não** é
prioridade; estabilidade e segurança são.

## Decisão

Adotar um **modelo de execução em 4 camadas**, hospedado em Node, do mais
restrito/seguro ao mais permissivo. Cada tier é selecionado pelo Execution Engine e
governado por **capabilities** (ADR de segurança no RAP §10) e pelo Resource Manager.

| Tier | Mecanismo | Uso | Garantias |
|---|---|---|---|
| **0** | **IR VM in-process** | Executar o **Plan IR** declarativo (orquestração de tools) | Sem código arbitrário; determinístico; cacheável |
| **1** | **`isolated-vm`** | Glue/expressões JS autoradas pelo modelo (transforms entre saídas) | Isolate V8 real: cap de RAM, timeout de CPU, sem ambiente Node |
| **2** | **WASM (wasmtime/wasmer via Node)** | Tools/plugins poliglotas + compute não-confiável | Sandbox forte; **fuel metering** (CPU); imports **WASI capability-scoped** |
| **3** | **`child_process` endurecido** | build/test/shell reais | Sandbox do SO: bubblewrap/landlock/seccomp + **cgroups v2** (CPU/RAM); bind do workspace; sem rede por padrão |

**Princípio:** a maior parte do trabalho de um agente é orquestração — resolvida no
Tier 0 **sem** executar código arbitrário. Só descemos de tier quando estritamente
necessário.

## Alternativas Consideradas

| Opção | Vantagens | Por que NÃO foi escolhida como base |
|---|---|---|
| **Node `vm`** | Trivial | **Não é fronteira de segurança** — escapável via `constructor`/`process`; sem limite de RAM |
| **Worker Threads** | Paralelismo real | **Isolamento de concorrência, não de segurança** (memória compartilhável, mesmo FS). Usado apenas para paralelismo de trabalho **confiável** |
| **Deno** | Permissões nativas, TS-first, seguro por padrão | **Excluído pela restrição de runtime.** Tecnicamente o mais elegante para sandbox de JS/TS; revisitar se a restrição mudar |
| **QuickJS** | JS minúsculo, determinístico | ES parcial e lento; mantido como **opção** para avaliar expressões puras determinísticas |
| **Runtime próprio** | Controle total | **NIH**; custo enorme; nenhum ganho sobre WASM + isolated-vm |
| **Core nativo (Rust/Go)** | Isolamento/controle máximos | Excluído pela restrição; documentado como caminho futuro se a ambição exigir |

## Consequências

- **Prós:** segurança real (CPU/RAM/FS/rede), poliglota (WASM), determinismo
  (Tier 0), tudo dentro do ecossistema Node. Resolve P3/P4 do RAP.
- **Contras:** custo de marshaling entre host e isolate/WASM; setup de sandbox de
  processo varia por SO (Linux robusto; macOS via `sandbox-exec`; Windows via Job
  Objects/AppContainer best-effort).
- **Riscos:** dependências nativas (`isolated-vm`) exigem build; mitigado por
  empacotamento e por degradar para Tier 3 quando `isolated-vm` não estiver
  disponível, sempre preservando os limites de capability.

## Notas de portabilidade

- **Linux:** bubblewrap + landlock + seccomp + cgroups v2 (caminho de referência).
- **macOS:** `sandbox-exec` (perfis), limites via `ulimit`/`posix_spawn`.
- **Windows:** Job Objects para limites de CPU/RAM; AppContainer quando possível.
- O contrato `SandboxBackend` (RAP §11.13) abstrai essas diferenças por trás de uma
  ABI única.
