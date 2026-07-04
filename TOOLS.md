# CloverOS — TOOLS

Catálogo oficial das ferramentas do CloverOS. Fonte da verdade sobre **o que
está implementado** vs **o que está planejado**. Toda tool registrada aqui é
visível ao Planner (via `kernel.listTools()`).

> Referências: arsenal em `@clover/tools` (`packages/tools/README.md`);
> arquitetura em `docs/architecture/`; execução em `PROGRESS.md`.

## Registradas hoje

### Base (`@clover/kernel`) — walking skeleton

| Tool | Descrição | Puro |
|------|-----------|------|
| `respond` | Resposta em linguagem natural ao usuário. | ✅ |
| `echo` | Retorna o texto recebido. | ✅ |
| `concat` | Concatena `a` + `b`. | ✅ |

### Departamento Git (`@clover/tools`, namespace `git/`) — leitura + escrita

Todas exigem capability `proc.exec` para `git` e executam via Sandbox Tier 3.
Nenhuma é `pure` (dependem do estado do repositório).
Refs/pathspecs sanitizados por `assertSafeRef` (rejeita arg com `-` inicial — injeção de opção).

#### Leitura (intent: `read`)

| Tool | Entrada (Zod) | Saída |
|------|---------------|-------|
| `git_status` | `{ cwd? }` | branch, oid, upstream, ahead/behind, files[], clean, truncated |
| `git_current_branch` | `{ cwd? }` | branch, detached |
| `git_log` | `{ maxCount?≤1000, path?, cwd? }` | commits[]{hash,author,email,date,subject}, truncated |
| `git_diff` | `{ staged?, ref?, path?, cwd? }` | files[]{status,path,origPath?}, patch, truncated |
| `git_branch_list` | `{ cwd? }` | branches[]{name,current} |
| `git_show_file` | `{ path, ref?=HEAD, cwd? }` | content, truncated |
| `git_blame` | `{ path, ref?, cwd? }` | lines[]{line,hash,author,content}, truncated |

#### Escrita/Destrutiva (Arsenal #3 — requerem autorização do Governor)

| Tool | Intent | Entrada (Zod) | Saída |
|------|--------|---------------|-------|
| `git_commit` | `write` | `{ message, stageAll?=true, authorName?, authorEmail?, cwd? }` | hash, branch, message |
| `git_checkout_branch` | `write` | `{ name, create?, cwd? }` | branch, created |
| `git_revert` | `write` | `{ commit, cwd? }` | hash, message |
| `git_restore` | `destructive` | `{ paths[], staged?, cwd? }` | restored (count) |

`git_restore` é o rollback automático do `Agent.runWithHeal`: chamado quando todas as tentativas de auto-cura falham, descartando alterações da working tree antes de retornar.

### Departamento FS (`@clover/tools`, namespace `fs/`) — leitura + escrita

Acesso a disco via `sys/fs` (chokepoint único, fronteira de workspace).
Escritas exigem autorização do Governor (intent `write`).

| Tool | Entrada (Zod) | Saída | Intent |
|------|---------------|-------|--------|
| `read_file_paginated` | `{ path, offset?≥1, limit?≤2000 }` | lines[]{n,text}, totalReturned, offset, nextOffset, eof | read |
| `write_file` | `{ path, content }` | path, bytes | write |
| `patch_file` | `{ path, search, replace, all? }` | path, replacements | write |

### Departamento Dev (`@clover/tools`, namespace `dev/`) — fundação de engenharia

| Tool | Entrada (Zod) | Saída | Intent | Motor |
|------|---------------|-------|--------|-------|
| `search_code` | `{ query, path?, maxResults?≤2000, ignoreCase? }` | matches[]{file,line,text}, truncated, engine | read | rg (Sandbox) → fallback Node |
| `run_build_and_test` | `{ step?=both, cwd?, timeoutMs? }` | success, engine, step, exitCode, stdout, stderr, truncated, failedCommand | read | pnpm/npm/yarn/cargo (Sandbox, 4 caps) |

`run_build_and_test` detecta o engine pelo arquivo de lock (pnpm-lock.yaml → yarn.lock → package-lock.json → Cargo.toml → package.json). Em falha, `success=false` + `stderr` legível alimenta o loop de auto-cura (`Agent.runWithHeal`).
`step`: `build` · `test` · `both` (default — build primeiro, para no primeiro erro).

## Roadmap de departamentos

Cada departamento segue o **mesmo padrão** do `git/` (Zod in/out, capability de
menor privilégio, execução via Sandbox, formatos à prova de máquina, testes).
São construídos como fatias verticais — uma de cada vez, real e testada.

| # | Departamento | Namespace | Status |
|---|--------------|-----------|--------|
| 1 | Foundation (search/read/write/exec/patch/ast/git) | `sys/` `fs/` `git/` | ✅ fs/ + dev/ + git/ + sys/exec |
| 2 | Engineering (refactor/generate/compile/lint/format) | `dev/` | 🟡 search_code + run_build_and_test implementados |
| 3 | Build (npm/pnpm/cargo/go/gradle/...) | `build/` | ⬜ planejado |
| 4 | CI/CD (test/coverage/bench/docker/k8s) | `ci/` | ⬜ planejado |
| 5 | AST (símbolos/refs/callers/tipos) | `ast/` | ⬜ planejado |
| 6 | Documentation (docs/mermaid/api/readme) | `documentation/` | ⬜ planejado |
| 7 | QA (mutation/property/snapshot/stress) | `qa/` | ⬜ planejado |
| 8 | Performance (cpu/heap/hotspot/sql) | `performance/` | ⬜ planejado |
| 9 | Security (secrets/audit/SAST/SBOM/CVE) | `security/` | ⬜ planejado (subconjunto defensivo primeiro) |
| 10 | Database (pg/mysql/sqlite/redis/mongo) | `database/` | ⬜ planejado |
| 11 | Network (nmap/tcpdump/dig/openssl) | `network/` | ⬜ planejado (wrappers locais autorizados) |
| 12 | Reverse Eng (ghidra/radare2/frida/...) | `reversing/` | ⬜ planejado (wrappers locais autorizados) |
| 13 | Windows (registry/services/wmi/etw/pe) | `windows/` | ⬜ planejado |
| 14 | Linux (systemd/journal/perf/ebpf) | `linux/` | ⬜ planejado |
| 15 | Browser (Playwright) | `browser/` | ⬜ planejado |
| 16 | Deep Research | `research/` | ⬜ planejado |
| 17 | Knowledge (vector/graph/embeddings) | `knowledge/` | 🟡 pacotes-base existem (`@clover/knowledge-*`) |
| 18 | Observability (otel/prom/traces) | `observability/` | ⬜ planejado |
| 19 | AI (multiagente: planner/coder/reviewer/...) | `ai/` | 🟡 planner/agent existem |

Legenda: ✅ pronto · 🟡 parcial · ⬜ planejado.

## Invariantes de segurança (valem para toda tool)

1. Zero `node:child_process` fora do Sandbox Tier 3.
2. Capability de **menor privilégio** declarada por tool; token cunhado pelo
   `CapabilityResolver` cobre só o declarado.
3. Argumentos do usuário validados por Zod; refs/pathspecs sanitizados contra
   injeção de opção; pathspecs após `--`.
4. Detecção de binário + versão; ausência = degradação graciosa, nunca crash do
   REPL.
5. **Governor obrigatório para writes**: `write`/`destructive` bloqueados pelo
   Executor (fail-safe) se nenhum `authorize` hook for injetado. O CLI sempre
   injeta o `ExecutionGovernor` — modo `step` pede aprovação, `auto` audita.
   Tools `read` passam sem chamar o Governor.
6. **Chokepoint de disco em `sys/fs`**: todo acesso a arquivos passa por
   `resolveInWorkspace` (fronteira de workspace, barramento de `..`). Escritas
   de fs tools NÃO passam pelo Sandbox Tier 3 — a trava é o Executor + Governor.
