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
| `git_clean` | `destructive` | `{ dryRun?, cwd? }` | removed[], dryRun |

**Resiliência de contexto (fim da alucinação git):** como o agente anda por qualquer
diretório, TODA tool git valida (via `runGit` → `assertGitRepo`) se o cwd/ancestrais
contêm `.git`. Se não, retorna `{ success:false, error: "Not a git repository (...). Use
basic FS tools (list_directory / read_file_paginated) instead." }` — guia o LLM às FS
tools em vez do críptico "fatal: not a git repository". Simétrico no motor semântico
AST: exige `tsconfig.json` (senão "Not a TS project ... Use basic FS tools instead").

`git_restore` + `git_clean` formam o **rollback total** do `Agent.runWithHeal`: na falha final da auto-cura, `git_restore -- .` reverte arquivos rastreados e `git_clean -fd` remove os untracked deixados pela tentativa (respeita `.gitignore`). **Atenção:** `git_clean` remove **TODOS** os untracked da working tree, não só os de uma tentativa específica — por isso `intent: destructive` e uso restrito ao caminho de falha final (nunca entre tentativas).

### Departamento FS (`@clover/tools`, namespace `fs/`) — leitura + escrita

Acesso a disco via `sys/fs` (chokepoint único, fronteira de workspace).
Escritas exigem autorização do Governor (intent `write`).

| Tool | Entrada (Zod) | Saída | Intent |
|------|---------------|-------|--------|
| `read_file_paginated` | `{ path, offset?≥1, limit?≤2000 }` | lines[]{n,text}, totalReturned, offset, nextOffset, eof | read |
| `write_file` | `{ path, content }` | path, bytes | write |
| `patch_file` | `{ path, search, replace, all? }` | path, replacements, **backup** | write |
| `list_files` | `{ path?, recursive?, maxResults? }` | entries[]{name,path,type,size}, truncated | read |
| `list_directory` | `{ path?, recursive?, maxResults? }` | path(abs), entries[], total, truncated | read |
| `get_current_directory` | `{}` | cwd, roaming | read |
| `change_working_directory` | `{ path }` | cwd, previous | read |

**The OS Explorer (agente global):** `path` pode ser relativo (ao diretório atual) ou
**ABSOLUTO** — `resolveGlobal` NÃO confina ao workspace. Leitura/navegação são livres
em qualquer diretório da máquina (sem prompt). `change_working_directory` move o "cwd
de sessão" (`sys/context.session`) + `process.cwd()`; o REPL propaga esse cwd ao
próximo goal (roaming persistente entre turnos). A antiga fronteira
(`resolveInWorkspace`) sobrevive só para o cache `.clover` (índice/knowledge/research).
A trava de **mutação** continua sendo o Governor por intent — `write`/`destructive`
pedem aprovação; reads passam direto (RM já funcionava assim).

`write_file` cria diretórios pais recursivamente (`mkdir -p`). `patch_file` grava um
backup `<path>.bak` do conteúdo **original** antes de sobrescrever — só *depois* de
validar que o trecho existe (patch malsucedido não deixa `.bak` espúrio). O caminho do
backup volta no campo `backup` da saída.

### Departamento Dev (`@clover/tools`, namespace `dev/`) — fundação de engenharia

| Tool | Entrada (Zod) | Saída | Intent | Motor |
|------|---------------|-------|--------|-------|
| `search_code` | `{ query, path?, maxResults?≤2000, ignoreCase? }` | matches[]{file,line,text}, truncated, engine | read | rg (Sandbox) → fallback Node |
| `run_build_and_test` | `{ step?=both, cwd?, timeoutMs? }` | success, engine, step, exitCode, stdout, stderr, truncated, failedCommand | read | pnpm/npm/yarn/cargo (Sandbox, 4 caps) |

`run_build_and_test` detecta o engine pelo arquivo de lock (pnpm-lock.yaml → yarn.lock → package-lock.json → Cargo.toml → package.json). Em falha, `success=false` + `stderr` legível alimenta o loop de auto-cura (`Agent.runWithHeal`).
`step`: `build` · `test` · `both` (default — build primeiro, para no primeiro erro).

### Departamento AST (`@clover/tools`, namespace `ast/`) — análise estática sintática

Camada de Language Server via **TypeScript Compiler API** (`ts.createSourceFile`).
**Escopo honesto:** análise de **um arquivo**, puramente **sintática** — sem
`Program`/`TypeChecker`/resolução de `tsconfig`. Logo, extrai o que está *escrito*
(declarações, imports/exports, assinaturas-como-escritas), mas **não** resolve tipos
nem referências cross-file (`find_references`/`find_type_definition` semânticos exigem
o Workspace Index — FASE 2.5, planejado). Todas são `read` (declaram `fs.read`).

| Tool | Entrada (Zod) | Saída |
|------|---------------|-------|
| `analyze_module` | `{ path }` | imports[], exports[], classes[], interfaces[], functions[], variables[], enums[], typeAliases[], decorators[] |
| `query_ast_symbol` | `{ path, name }` | found, matches[]{name,kind,line,column,exported,signature} |
| `find_inheritance` | `{ path, name? }` | entries[]{name,kind,extends[],implements[]} |
| `find_documentation` | `{ path, name }` | found, docs[]{symbol,kind,line,doc} |

Formas de `import` cobertas: default · named · namespace (`* as`) · side-effect.
Formas de `export` cobertas: inline em declaração · `export {}` · `export {} from` ·
`export * from` · `export default`. Extensões: `.ts/.tsx/.js/.jsx/.mts/.cts` — outra
extensão retorna `{ success: false }` (degradação graciosa, nunca lança).

#### Motor Semântico (`ast/program.ts` + `ast/semantic.ts`) — TypeChecker real

Resolução por **binding** via `ts.LanguageService`: um `save()` na classe A jamais se
confunde com `save()` na classe B (testado). **Anti-OOM:** um LanguageService **lazy e
cacheado por workspace** (LRU, cap 2, `dispose()` no despejo); snapshots versionados
por **mtime** → só arquivos alterados reparsam entre chamadas (mesma filosofia do
Workspace Index). Alvo das tools: `{ path, name, line? }` — múltiplas ocorrências só
exigem `line` se resolverem para símbolos DISTINTOS (identidade do checker, aliases
resolvidos); caso contrário o erro estruturado lista os candidatos.

| Tool | Intent | Saída (essência) |
|------|--------|------------------|
| `find_references` | read | references[]{path,line,column,isDefinition,isWriteAccess} — semântico |
| `find_callers` | read | incoming call hierarchy: callers[]{name,path,line,callLines[]} |
| `find_callees` | read | outgoing call hierarchy: callees[]{name,path,line,callLines[]} |
| `rename_symbol` | write | **APLICA** rename multi-arquivo com backup `.bak` por arquivo modificado; `dryRun` lista sem aplicar |

Estas versões semânticas **substituem no registro** as antigas name-based do `index/`
(exports mantidos por ABI, depreciados). `rename_symbol` valida o novo identificador,
aplica edits de trás pra frente (offsets estáveis) e NUNCA toca homônimos não
relacionados.

### Workspace Index (`@clover/tools`, namespace `index/`) — FASE 2.5

Índice **persistente e incremental** do workspace: símbolos + grafo de imports em
SQLite (**sql.js**/WASM — zero dependência nativa, mesmo motivo do backend), gravado
em `.clover/index.db` (gitignored via `*.db`). Extração de AST reusa o parser do
`@clover/ast-index` (TS Compiler API). **Incremental por `mtime`+`size`**: um arquivo
só é reparseado se mudou; deletados saem do índice. Skip: `.git`, `node_modules`,
`dist`, `.clover`, `coverage`. Toda consulta tem `ORDER BY` (saída determinística).

| Tool | Entrada (Zod) | Saída |
|------|---------------|-------|
| `workspace_index` | `{}` | dbPath, indexed, skipped, removed, files, symbols, imports |
| `find_references` | `{ name }` | found, definitions[]{path,kind,line,exported,container}, importSites[]{path,module,names,line} |
| `rename_symbol` | `{ name, newName }` | applied:`false`, wouldChange[]{path,line,site,kind}, note |

**Exceção consciente ao invariante #6:** as tools têm `intent: read` mas gravam o
*cache* `.clover/index.db` — não tocam código-fonte do usuário; leitura-com-cache não
passa pelo Governor. **Escopo honesto:** `find_references` é baseado em **nome**
(definições + sites de import pelo identificador), não em resolução semântica de
binding. `rename_symbol` é **dry-run/preview** — lista o que mudaria e **não aplica
nada**: rename seguro exige TypeChecker (aplicar por nome corromperia homônimos).
Rotas HTTP/modelos ORM: adiado — nenhum framework HTTP/ORM no workspace atual para
validar contra código real (regra Zero Ficção); entra quando houver alvo real.

### Code Intelligence (`@clover/tools`, namespace `intelligence/`) — FASE 4.5

Compreensão profunda do workspace **construída sobre o Workspace Index** (as tools
consultam o índice SQLite, não reprocessam AST). Motor de grafo puro em
`intelligence/graph.ts` (resolução de import relativo, ciclos via DFS canonicalizada,
deps diretas/reversas); scanners de convenção/conteúdo em `intelligence/scan.ts`.
Todas `read` + `fs.read`; mesma exceção de cache do `index/`.

| Tool | Entrada (Zod) | Saída (essência) |
|------|---------------|------------------|
| `find_todos` / `find_fixmes` | `{ maxResults? }` | hits[]{file,line,text}, truncated |
| `find_cycles` | `{ maxCycles? }` | cycles[][] (canonicalizados) |
| `find_dependencies` | `{ path }` | internal[] (resolvidos), external[] (pacotes) |
| `find_reverse_dependencies` | `{ path }` | dependents[] (análise de impacto) |
| `find_unused_exports` | `{}` | unused[]{path,name,kind,line}, note |
| `find_unused_files` | `{}` | unused[] (órfãos), note |
| `find_large_functions` / `find_large_classes` | `{ minLines? }` | found[]{path,name,lines,...} (spans do índice) |
| `find_test_files` | `{}` | files[] (convenção *.test/*.spec/__tests__) |
| `find_entrypoints` | `{}` | fromManifests[] (main/bin) + conventional[] |
| `find_configurations` | `{}` | files[] (tsconfig*, *.config.*, rc) |
| `find_build_scripts` | `{}` | packages[]{package,manifest,scripts} |
| `find_environment_variables` | `{}` | variables[]{name,file,line}, uniqueNames[] |
| `summarize_project_architecture` | `{}` | stats, packages, topExternalModules, ciclos, testes — objeto tipado, não prosa |

**Escopo honesto:** análise **sintática/name-based** sobre o índice — sem TypeChecker.
`find_unused_exports`/`find_unused_files` documentam falsos positivos (barrels,
`export *`, dynamic import) no campo `note`. Grafo cobre imports **relativos**;
ciclos entre pacotes do monorepo via specifier de pacote não são detectados.
`find_large_*` usa spans (`endLine`) persistidos no índice (schema v2).

### Knowledge Base (`@clover/tools`, namespace `knowledge/`) — FASE 1 ("O Cérebro")

Banco de conhecimento **híbrido** (mandato): **Markdown legível** em
`.clover/knowledge/<id>.md` = fonte da verdade (frontmatter próprio, editável à mão)
+ **SQLite** (`.clover/knowledge.db`, sql.js) = índice de consulta reconstruível.
Ranqueamento por **BM25 real** (`knowledge/rank.ts` — Okapi, k1=1.2/b=0.75, puro e
determinístico). Escritas passam pelo Governor (`write`/`destructive` — os .md são
conteúdo durável, NÃO cache); consultas são `read`.

| Tool | Intent | Entrada (Zod) | Saída (essência) |
|------|--------|---------------|------------------|
| `save_memory` | write | `{ title, content, tags? }` | doc completo (id = slug do título) |
| `update_memory` | write | `{ id, title?, content?, tags? }` | doc atualizado |
| `delete_memory` | destructive | `{ id }` | deleted (poda links reversos nos .md dos linkers) |
| `query_memory` | read | `{ text?, tag? }` | busca estruturada (LIKE + tag) |
| `semantic_search` | read | `{ query, topK? }` | ranqueado BM25, `engine:'bm25'` |
| `list_memories` | read | `{ tag? }` | resumos ordenados |
| `memory_stats` | read | `{}` | total, histograma de tags, links, bytes |
| `compact_memory` | write | `{}` | reconcilia md⇄sqlite (editados à mão entram, órfãos saem, links pendurados podados) |
| `tag_memory` | write | `{ id, add?, remove? }` | tags finais |
| `link_memories` | write | `{ from, to, bidirectional? }` | grafo de conhecimento nos frontmatters |

**Escopo honesto:** `semantic_search` é recuperação **léxica** (BM25 — algoritmo
clássico de search engine), não embedding neural; a descrição da tool declara isso.
Embeddings entram atrás da MESMA interface quando houver modelo local disponível.

### Deep Research (`@clover/tools`, namespace `research/`) — FASE 3

Pesquisa externa com **fetcher injetável** (`makeResearchTools(fetcher)`): produção usa
o `fetch` global do Node; testes injetam fake determinístico (precedente OllamaProvider
— caminho vivo real, teste sem rede). Primeiro departamento com capability **`net`**.
**Timeout real** por chamada (`timeoutMs` → AbortController). Cache em
`.clover/research-cache/` (`maxAgeMs` controla reuso; falha de rede degrada
graciosamente para cache velho).

| Tool | Entrada (Zod) | Saída (essência) |
|------|---------------|------------------|
| `fetch_documentation` | `{ url, timeoutMs?, maxAgeMs? }` | title, text (HTML→texto), fromCache, truncated |
| `fetch_markdown` | `{ url, ... }` | markdown, headings[] |
| `fetch_github_readme` | `{ owner, repo, ... }` | markdown + headings via raw.githubusercontent (HEAD) |
| `fetch_openapi` | `{ url, ... }` | title, version, pathCount, operations[]{method,path,summary} |
| `fetch_json_schema` | `{ url, ... }` | dialect, title, type, required[], properties de topo |
| `cache_documentation` | `{ url, content, contentType? }` | semeia cache manualmente (offline) |
| `search_documentation` | `{ query, topK? }` | BM25 **no cache local** (engine:'bm25-local-cache') |
| `summarize_documentation` | `{ url, ... }` | headings tree + 1º parágrafo/seção + contagens (extrativo) |

**Escopo honesto:** `search_documentation` busca no cache local — NÃO é motor de busca
web (sem API de search). `fetch_openapi` só JSON (sem parser YAML no arsenal).
`summarize_documentation` é extrativo/determinístico — prosa é papel do Planner.
HTML→texto por regex estruturada (páginas de doc), não um browser.

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
| 5 | AST (símbolos/refs/callers/tipos) | `ast/` `index/` | 🟢 sintático + **Motor Semântico** (find_references/callers/callees por binding; rename_symbol aplica com .bak) + Workspace Index |
| 5.5 | Code Intelligence (grafo/dead-code/métricas/convenções) | `intelligence/` | 🟡 15 tools index-backed (ciclos, deps/reversas, unused, large-*, todos/fixmes, env, entrypoints, summary) |
| 6 | Documentation (docs/mermaid/api/readme) | `documentation/` | ⬜ planejado |
| 7 | QA (mutation/property/snapshot/stress) | `qa/` | ⬜ planejado |
| 8 | Performance (cpu/heap/hotspot/sql) | `performance/` | ⬜ planejado |
| 9 | Security (secrets/audit/SAST/SBOM/CVE) | `security/` | ⬜ planejado (subconjunto defensivo primeiro) |
| 10 | Database (pg/mysql/sqlite/redis/mongo) | `database/` | ⬜ planejado |
| 11 | Network (nmap/tcpdump/dig/openssl) | `network/` | ⬜ planejado (wrappers locais autorizados) |
| 12 | Reverse Eng / Internals (PE/ELF, .NET, PCAP, archives) | `reversing/` `internals/` | ⬜ **bloqueado por ambiente**: tshark/ilspycmd/dumpbin/objdump ausentes nesta máquina (verificado); wrappers sem binário real = ficção |
| 13 | Windows (registry/services/wmi/etw/pe) | `windows/` | ⬜ planejado |
| 14 | Linux (systemd/journal/perf/ebpf) | `linux/` | ⬜ planejado |
| 15 | Browser (Playwright) | `browser/` | ⬜ planejado |
| 16 | Deep Research | `research/` | 🟡 8 tools reais (fetcher injetável, cache, BM25 local); busca web real quando houver API |
| 17 | Knowledge (vector/graph/embeddings) | `knowledge/` | 🟡 10 tools reais (híbrido md+SQLite, BM25); embeddings neurais quando houver modelo local |
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
