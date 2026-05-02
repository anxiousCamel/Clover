# Tasks — Clover Local AI Assistant

Format: `- [ ] TASK-NNN | {agent} | depends:{ids|none} | description | done when: {criterion}`

Agents: planner · coder · reviewer · executor

---

## Phase 0 — Monorepo Scaffold

- [ ] TASK-001 | coder | depends:none | Initialize pnpm workspaces monorepo with `apps/ui`, `apps/backend`, `shared` packages | done when: `pnpm install` succeeds at root; each package has its own `package.json`
- [ ] TASK-002 | coder | depends:TASK-001 | Create `shared/types/` with TypeScript interfaces: `messages.ts`, `tools.ts`, `agents.ts`, `memory.ts`, `search.ts` | done when: all interfaces compile with `tsc --noEmit`; no `any` types
- [ ] TASK-003 | coder | depends:TASK-001 | Create `shared/protos/openclaude.proto` with CompletionService, CompletionRequest, CompletionChunk, Message, Tool, ToolCall, UsageStats | done when: `protoc` compiles proto without errors
- [ ] TASK-004 | coder | depends:TASK-003 | Generate gRPC TypeScript stubs from proto into `shared/protos/generated/` | done when: generated `*_grpc_pb.d.ts` and `*_pb.d.ts` files exist and are importable
- [ ] TASK-005 | coder | depends:TASK-001 | Create `config/default.config.json` (ports, timeouts, paths) and `config/models.config.json` (model list with capabilities) | done when: both files valid JSON; `models.config.json` includes at least one entry with `capabilities:["chat"]` and one with `capabilities:["embed"]`
- [ ] TASK-006 | reviewer | depends:TASK-002,TASK-003,TASK-004,TASK-005 | Review monorepo scaffold: types completeness, proto coverage, config structure | done when: all FR/NF contracts from design.md are represented in types; no gaps identified

---

## Phase 1 — Backend Foundation

- [ ] TASK-007 | coder | depends:TASK-006 | Create `apps/backend/src/config/config.ts` that loads `default.config.json` + env var overrides; exports typed `Config` object | done when: unit test imports config and accesses `config.gateway.port` without type error
- [ ] TASK-008 | coder | depends:TASK-007 | Create `apps/backend/src/storage/sqlite.store.ts` with: createSession, getSession, saveMessage, getHistory(sessionId, limit), logToolExecution | done when: integration test creates session, saves 3 messages, retrieves them in order
- [ ] TASK-009 | coder | depends:TASK-007 | Create `apps/backend/src/ollama/ollama.client.ts` with: chat(messages, model), embed(text, model), listModels(); HTTP client with retry (3 attempts, 1s backoff) | done when: `ollama.client.listModels()` returns array when Ollama is running; throws typed error when Ollama is unreachable
- [ ] TASK-010 | coder | depends:TASK-004,TASK-007 | Create `apps/backend/src/openclaude/openclaude.client.ts` with: streamComplete(request) → AsyncIterable<CompletionChunk>, complete(request) → CompletionResponse; gRPC reconnection on disconnect | done when: streamComplete emits at least one token chunk when OpenClaude is running
- [ ] TASK-011 | reviewer | depends:TASK-007,TASK-008,TASK-009,TASK-010 | Review backend foundation: config typing, SQLite schema, Ollama client retry logic, gRPC client reconnection | done when: no race conditions, no unhandled promise rejections, error types are explicit

---

## Phase 2 — Memory System

- [ ] TASK-012 | coder | depends:TASK-009 | Create `apps/backend/src/memory/chunker.ts`: split(text) → Chunk[] using tiktoken; 512 token chunks, 50 token overlap; preserves sentence boundaries where possible | done when: chunker.split("...long text...") returns chunks where no chunk exceeds 512 tokens per tiktoken count
- [ ] TASK-013 | coder | depends:TASK-009 | Create `apps/backend/src/memory/embedder.ts`: embed(text) → float[]; calls ollama.client with configured embed model; caches nothing (stateless) | done when: embedder.embed("hello") returns float[] of length matching model's embedding dimension
- [ ] TASK-014 | coder | depends:TASK-007 | Create `apps/backend/src/memory/lancedb.adapter.ts`: init(dbPath), insert(chunks), upsertByPath(path, chunks), similaritySearch(vector, topK, filter?) → Chunk[]; uses LanceDB SDK | done when: insert 10 chunks, similarity search returns top-3 with score field populated
- [ ] TASK-015 | coder | depends:TASK-007 | Create `apps/backend/src/memory/obsidian.adapter.ts`: read(filePath), writeNote(filePath, content, mode: "create-only"|"append"|"overwrite"); "overwrite" creates .bak before writing; "create-only" throws if file exists | done when: write "create-only" to existing file throws; "overwrite" creates .bak then writes; "append" appends with separator
- [ ] TASK-016 | coder | depends:TASK-012,TASK-013,TASK-014,TASK-015 | Create `apps/backend/src/memory/memory.service.ts` implementing MemoryService interface: search, indexText, indexFile, ingestDirectory, writeNote, watchVault | done when: indexFile on a markdown file → subsequent search returns relevant chunk with score > 0.7
- [ ] TASK-017 | coder | depends:TASK-016 | Create `apps/backend/src/memory/vault.watcher.ts`: fs.watch on configured vaultPath; debounce 500ms; calls memory.service.indexFile on change events | done when: editing a vault file triggers re-index within 1s
- [ ] TASK-018 | reviewer | depends:TASK-012,TASK-013,TASK-014,TASK-015,TASK-016,TASK-017 | Review memory system: chunk overlap correctness, upsert idempotency, vault write safety rules, watcher debounce | done when: no silent overwrites possible; upsert on same path removes old chunks first; write safety rules match design.md spec

---

## Phase 3 — Search System

- [ ] TASK-019 | coder | depends:TASK-007 | Create `apps/backend/src/search/connectivity.check.ts`: isOnline() → Promise<boolean>; HEAD request to `1.1.1.1` with 2s timeout | done when: returns true when internet available; returns false when offline (tested by blocking network in unit test)
- [ ] TASK-020 | coder | depends:TASK-007 | Create `apps/backend/src/search/duckduckgo.adapter.ts` implementing SearchAdapter: name="duckduckgo", isAvailable() calls connectivity.check, search(query) → SearchResult[] | done when: search("Node.js gRPC") returns at least 1 result with title, url, snippet when online
- [ ] TASK-021 | coder | depends:TASK-014 | Create `apps/backend/src/search/offline.adapter.ts` implementing SearchAdapter: name="offline", isAvailable() always true, search(query) calls lancedb.adapter on knowledge index | done when: search returns relevant chunks from LanceDB when called offline
- [ ] TASK-022 | coder | depends:TASK-019,TASK-020,TASK-021 | Create `apps/backend/src/search/search.service.ts`: search(query) calls isOnline() → uses duckduckgo if true, offline if false; adapter list ordered by priority; isAvailable() checked before use | done when: when DuckDuckGo adapter.isAvailable() returns false, search.service automatically uses offline adapter
- [ ] TASK-023 | reviewer | depends:TASK-019,TASK-020,TASK-021,TASK-022 | Review search system: fallback logic, adapter interface compliance, connectivity check timeout | done when: adapter swap requires only registration change; no caller modification needed

---

## Phase 4 — Exec Guard + Confirmation Bus

- [ ] TASK-024 | coder | depends:TASK-007 | Create `apps/backend/src/exec-guard/deny-list.ts`: array of regex patterns for blocked commands; patterns cover: `rm -rf /`, `format`, `mkfs`, `dd if=`, `:(){ :|:& };:` and variants | done when: deny-list matches all listed patterns; does not block `rm ./file.txt` or `npm run build`
- [ ] TASK-025 | coder | depends:TASK-024 | Create `apps/backend/src/exec-guard/exec-guard.ts`: run(cmd, opts: { cwd, timeout }) → { stdout, stderr, exitCode }; uses child_process.spawn; enforces cwd=workspace; checks deny-list before spawn; streams output via callback | done when: exec-guard.run("ls", { cwd:workspace }) returns { exitCode:0 }; exec-guard.run("rm -rf /", ...) throws DeniedCommandError without spawning
- [ ] TASK-026 | coder | depends:TASK-007 | Create `apps/backend/src/confirmation/confirmation.bus.ts`: request(data) → Promise<boolean>; stores pending requests by requestId; resolves when ws.server receives matching confirmation:response; rejects after 60s | done when: request() resolves true when UI responds approved; resolves false when denied; rejects with TimeoutError after 60s
- [ ] TASK-027 | reviewer | depends:TASK-024,TASK-025,TASK-026 | Review exec-guard deny-list coverage and confirmation bus timeout behavior | done when: deny-list has no false positives on common dev commands; confirmation bus cannot leak pending promises on server restart

---

## Phase 5 — Tool Registry + Plugins

- [ ] TASK-028 | coder | depends:TASK-025,TASK-026 | Create `apps/backend/src/tools/tool-registry.ts`: loadPlugins() auto-discovers `plugins/*.tool.ts` via glob; execute(name, args, ctx) validates with Zod then calls plugin.execute; calls confirmation.bus if requiresConfirmation returns true | done when: dropping a new `*.tool.ts` in plugins/ makes it discoverable without code change; Zod validation failure returns typed error to caller
- [ ] TASK-029 | coder | depends:TASK-028 | Create `tools/plugins/read-file.tool.ts`: reads file at path within workspace; requiresConfirmation always false; validates path stays within workspacePath | done when: read file within workspace returns content; read file outside workspace throws WorkspaceBoundaryError
- [ ] TASK-030 | coder | depends:TASK-028 | Create `tools/plugins/write-file.tool.ts`: writes file; requiresConfirmation returns true if file exists (overwrite case); uses obsidian.adapter.writeNote | done when: writing new file succeeds silently; writing existing file triggers confirmation flow
- [ ] TASK-031 | coder | depends:TASK-028 | Create `tools/plugins/edit-file.tool.ts`: patch edit via string replacement or line-range replacement; never rewrites full file; requiresConfirmation always false | done when: patch replaces exactly one occurrence; throws AmbiguousMatchError if pattern matches multiple lines
- [ ] TASK-032 | coder | depends:TASK-028 | Create `tools/plugins/list-files.tool.ts`: lists directory with name, type, size, mtime; depth parameter (default 1); requiresConfirmation always false | done when: list returns FileNode[] with correct types for files and directories
- [ ] TASK-033 | coder | depends:TASK-025,TASK-028 | Create `tools/plugins/execute-command.tool.ts`: runs command via exec-guard; requiresConfirmation always true; streams output chunks via ctx.emitEvent | done when: execute-command always triggers confirmation dialog; output streams to terminal:output WS event during execution
- [ ] TASK-034 | coder | depends:TASK-022,TASK-028 | Create `tools/plugins/search-online.tool.ts`: calls search.service.search(query); requiresConfirmation always false; returns SearchResult[] formatted as string | done when: tool returns search results or offline fallback results transparently
- [ ] TASK-035 | coder | depends:TASK-016,TASK-028 | Create `tools/plugins/search-memory.tool.ts`: calls memory.service.search(query, topK, filter); requiresConfirmation always false | done when: returns Chunk[] with source, text, score fields
- [ ] TASK-036 | coder | depends:TASK-016,TASK-028 | Create `tools/plugins/memory-write.tool.ts`: calls memory.service.writeNote; requiresConfirmation returns true for mode="overwrite"; false for "append" and "create-only" | done when: overwrite triggers confirmation; append does not
- [ ] TASK-037 | coder | depends:TASK-016,TASK-028 | Create `tools/plugins/reversa-ingest.tool.ts`: calls memory.service.ingestDirectory(".agents/skills/") + memory.service.indexFile("CLAUDE.md") if exists; requiresConfirmation always false | done when: after ingestion, search-memory returns chunks with source="reversa"
- [ ] TASK-038 | reviewer | depends:TASK-029,TASK-030,TASK-031,TASK-032,TASK-033,TASK-034,TASK-035,TASK-036,TASK-037 | Review all tool plugins: workspace boundary enforcement, confirmation classification, Zod schema correctness | done when: all tools have Zod schemas that reject invalid args with typed errors; no tool can write outside workspace without confirmation

---

## Phase 6 — Agent System

- [ ] TASK-039 | coder | depends:TASK-010,TASK-028 | Define `Agent` interface in `shared/types/agents.ts`: name, systemPrompt, allowedTools: string[], matchesIntent(message, context), maxTurns | done when: interface compiles; all agent fields are required (no optional fields)
- [ ] TASK-040 | coder | depends:TASK-039 | Create `agents/coder.agent.ts`: system prompt focused on software implementation; allowedTools: [read-file, write-file, edit-file, list-files, execute-command, search-memory]; matchesIntent detects coding/implementation requests | done when: agent instance passes Agent interface; matchesIntent("write a function that...") returns true
- [ ] TASK-041 | coder | depends:TASK-039 | Create `agents/reviewer.agent.ts`: system prompt focused on code review; allowedTools: [read-file, list-files, search-memory]; matchesIntent detects review requests | done when: matchesIntent("review this code") and "check this diff" return true
- [ ] TASK-042 | coder | depends:TASK-039 | Create `agents/executor.agent.ts`: system prompt focused on running commands and scripts; allowedTools: [execute-command, list-files, read-file]; matchesIntent detects run/execute/test requests | done when: matchesIntent("run the tests") returns true
- [ ] TASK-043 | coder | depends:TASK-039 | Create `agents/researcher.agent.ts`: system prompt focused on information gathering; allowedTools: [search-online, search-memory, read-file]; matchesIntent detects research/explain/find requests | done when: matchesIntent("what is gRPC") returns true
- [ ] TASK-044 | coder | depends:TASK-039 | Create `agents/memory.agent.ts`: system prompt focused on memory management; allowedTools: [search-memory, memory-write, reversa-ingest]; matchesIntent detects memory/remember/save requests | done when: matchesIntent("remember this") and "save to vault" return true
- [ ] TASK-045 | coder | depends:TASK-039 | Create `agents/planner.agent.ts`: system prompt focused on planning; allowedTools: [list-files, read-file, search-memory]; matchesIntent detects planning/design/plan requests | done when: matchesIntent("create a plan for") and "/plan" return true
- [ ] TASK-046 | coder | depends:TASK-010,TASK-028,TASK-039,TASK-040,TASK-041,TASK-042,TASK-043,TASK-044,TASK-045 | Create `agents/agent-engine.ts`: loadAgents() discovers all *.agent.ts; dispatch(request, sessionId) calls matchesIntent in priority order; manages streaming; intercepts tool_calls; emits WS status events; supports cancel | done when: dispatch routes "write a function" to CoderAgent; emits agent:status running then done; tool_call triggers tool-registry.execute
- [ ] TASK-047 | reviewer | depends:TASK-040,TASK-041,TASK-042,TASK-043,TASK-044,TASK-045,TASK-046 | Review agent system: intent routing completeness (no message falls through unhandled), tool allowlist enforcement, cancel behavior | done when: every message routes to exactly one agent; tool not in agent's allowlist is rejected before execution; cancel stops gRPC stream cleanly

---

## Phase 7 — Orchestrator + Session Manager

- [ ] TASK-048 | coder | depends:TASK-008 | Create `apps/backend/src/orchestrator/session.manager.ts`: createSession(workspacePath), loadHistory(sessionId, limit=20), saveMessage(sessionId, message), buildContextWindow(sessionId, memoryChunks) → Message[] | done when: buildContextWindow returns [system_prompt, ...memoryChunks, ...history, userMessage] in correct order
- [ ] TASK-049 | coder | depends:TASK-016,TASK-046,TASK-048 | Create `apps/backend/src/orchestrator/orchestrator.ts`: handle(sessionId, userMessage) → calls loadHistory + memory.search + builds CompletionRequest + calls agent-engine.dispatch + saves turn + indexes to memory | done when: end-to-end call completes and new turn appears in SQLite history and LanceDB
- [ ] TASK-050 | reviewer | depends:TASK-048,TASK-049 | Review orchestrator: context window construction order, memory indexing after completion, session isolation | done when: sessions do not share history; memory chunks are correctly prepended; turn is indexed only after successful completion

---

## Phase 8 — Gateway (HTTP + WebSocket)

- [ ] TASK-051 | coder | depends:TASK-049 | Create `apps/backend/src/gateway/http.server.ts`: Fastify instance; CORS restricted to localhost; registers all route files; starts on config.gateway.port | done when: `GET /api/health` returns 200 when server running
- [ ] TASK-052 | coder | depends:TASK-026,TASK-051 | Create `apps/backend/src/gateway/ws.server.ts`: `@fastify/websocket`; manages connections by sessionId; exposes emit(sessionId, event) and onEvent(type, handler); used by confirmation.bus | done when: WS client connects, sends `chat:send`, receives at least one `message:token` back
- [ ] TASK-053 | coder | depends:TASK-049,TASK-051 | Create `gateway/routes/chat.routes.ts`: `POST /api/chat/message` → calls orchestrator.handle → 202; `GET /api/sessions/:id/history`; `POST /api/sessions`; `DELETE /api/sessions/:id` | done when: POST /api/chat/message returns 202 and WS stream follows
- [ ] TASK-054 | coder | depends:TASK-029,TASK-030,TASK-031,TASK-032,TASK-051 | Create `gateway/routes/files.routes.ts`: GET/POST/PATCH/DELETE /api/files; GET /api/filesystem/tree | done when: all endpoints return correct status codes; DELETE triggers confirmation before executing
- [ ] TASK-055 | coder | depends:TASK-016,TASK-051 | Create `gateway/routes/memory.routes.ts`: GET /api/memory/search; POST /api/memory/ingest | done when: search returns Chunk[]; ingest returns 202 and emits memory:indexed WS event on completion
- [ ] TASK-056 | coder | depends:TASK-009,TASK-051 | Create `gateway/routes/models.routes.ts` + `gateway/routes/health.routes.ts`: GET /api/models; PATCH /api/config/model; GET /api/health | done when: /api/health reports correct status for each dependency
- [ ] TASK-057 | reviewer | depends:TASK-051,TASK-052,TASK-053,TASK-054,TASK-055,TASK-056 | Review gateway: route validation schemas, WS connection lifecycle, error response format consistency | done when: all routes validate request body with Fastify schema; errors return `{ error: string, code: string }`

---

## Phase 9 — Planner Service

- [ ] TASK-058 | coder | depends:TASK-010,TASK-016 | Create `planner/templates/requirements.prompt.ts`: template function that takes { goal, fileTree, memoryChunks, reversaContext } → string; output must contain FR/NF/Constraints/OutOfScope sections | done when: template renders without undefined fields; output format matches requirements.md structure
- [ ] TASK-059 | coder | depends:TASK-058 | Create `planner/templates/design.prompt.ts`: takes { goal, requirementsContent, fileTree, memoryChunks } → string; output must contain Architecture/Components/DataFlow/Decisions sections | done when: template renders correctly
- [ ] TASK-060 | coder | depends:TASK-059 | Create `planner/templates/tasks.prompt.ts`: takes { goal, requirementsContent, designContent } → string; enforces task format `TASK-NNN | agent | depends:X | "description" | done when: criterion` | done when: template includes explicit format rules in system prompt
- [ ] TASK-061 | coder | depends:TASK-010,TASK-015,TASK-016,TASK-058,TASK-059,TASK-060 | Create `planner/planner.service.ts`: generate(goal, workspacePath) runs 4 phases; each phase calls openclaude.client.complete with template; writes file via obsidian.adapter; emits planner:progress WS events | done when: generate("build a TODO app", workspace) produces all 3 files in workspace; planner:done WS event fires with file list
- [ ] TASK-062 | coder | depends:TASK-061,TASK-051 | Create `gateway/routes/planner.routes.ts`: POST /api/planner/generate → calls planner.service.generate async → 202 { taskId } | done when: POST returns 202 immediately; files appear in workspace after async completion
- [ ] TASK-063 | reviewer | depends:TASK-058,TASK-059,TASK-060,TASK-061,TASK-062 | Review planner: template format strictness, create-only write mode enforcement, WS progress events completeness | done when: planner never silently overwrites existing planning files; all 4 phases emit progress events

---

## Phase 10 — React UI

- [ ] TASK-064 | coder | depends:TASK-052 | Create `apps/ui/src/api/ws.client.ts`: WebSocket singleton; typed event emitter; auto-reconnect with exponential backoff; onEvent(type, handler) and emit(type, data) | done when: disconnecting and reconnecting does not lose pending event handlers
- [ ] TASK-065 | coder | depends:TASK-051 | Create `apps/ui/src/api/http.client.ts`: typed fetch wrapper; base URL from config; methods: get, post, patch, delete; throws typed HttpError on non-2xx | done when: http.client.get("/api/health") returns parsed JSON; 404 throws HttpError with status field
- [ ] TASK-066 | coder | depends:TASK-064,TASK-065 | Create Zustand stores: `chat.store.ts` (sessions, messages, streaming state), `agent.store.ts` (agent status map, active tool calls), `session.store.ts` (active session, workspace path, active model) | done when: stores compile with strict TypeScript; no `any` types
- [ ] TASK-067 | coder | depends:TASK-066 | Create `components/Chat/ChatWindow.tsx` + `MessageBubble.tsx` + `StreamingCursor.tsx`: renders message history, displays streaming tokens via ws:message:token events, markdown rendering with syntax highlight | done when: streaming message appears character by character; completed messages render markdown correctly
- [ ] TASK-068 | coder | depends:TASK-065,TASK-066 | Create `components/FileExplorer/FileTree.tsx` + `FilePreview.tsx`: tree from GET /api/filesystem/tree; click file → GET /api/files → preview pane | done when: tree renders workspace files; clicking file shows content in preview
- [ ] TASK-069 | coder | depends:TASK-064,TASK-066 | Create `components/Terminal/TerminalPane.tsx`: xterm.js instance; connects to terminal WS stream; input sent via terminal:input WS event; output rendered from terminal:output events | done when: typing in terminal pane sends commands; stdout appears in pane
- [ ] TASK-070 | coder | depends:TASK-064,TASK-066 | Create `components/AgentPanel/AgentStatusList.tsx` + `TaskProgress.tsx`: displays agent:status WS events; shows running agent name, status, elapsed time | done when: starting a chat message shows agent as "running"; completion shows "done"
- [ ] TASK-071 | coder | depends:TASK-064,TASK-066 | Create `components/ConfirmDialog/ConfirmDialog.tsx`: modal triggered by confirmation:request WS event; displays operation, details, full args; Approve/Deny buttons; sends confirmation:response WS event | done when: approval/denial response reaches backend within 1s of button click
- [ ] TASK-072 | coder | depends:TASK-065,TASK-066 | Create `components/ModelSelector/ModelSelector.tsx`: fetches GET /api/models; dropdown; PATCH /api/config/model on change; persists in session.store | done when: selecting a model updates backend config; selection survives page reload via session.store
- [ ] TASK-073 | coder | depends:TASK-067,TASK-068,TASK-069,TASK-070,TASK-071,TASK-072 | Create `App.tsx`: layout with Chat, FileExplorer, Terminal, AgentPanel, ModelSelector panels; ConfirmDialog as global overlay; initialize WS connection and session on mount | done when: all panels render without errors; WS connects on app load
- [ ] TASK-074 | reviewer | depends:TASK-064,TASK-065,TASK-066,TASK-067,TASK-068,TASK-069,TASK-070,TASK-071,TASK-072,TASK-073 | Review UI: no direct backend calls from components (all through stores/api layer); no `any` types; confirmation dialog blocks interaction until resolved | done when: no component imports from apps/backend/; all network calls go through http.client or ws.client

---

## Phase 11 — Tauri Shell

- [ ] TASK-075 | coder | depends:TASK-073 | Configure `src-tauri/tauri.conf.json`: set `fs.scope` to workspace path only; set `allowlist.fs.all: false`; configure window title, size, min-size | done when: Tauri build succeeds; attempting to read file outside workspace from Tauri invoke throws permission error
- [ ] TASK-076 | coder | depends:TASK-075 | Create `src-tauri/src/main.rs`: Tauri app with single window; spawn Node.js backend process on app start; kill backend process on app exit; pass workspace path as env var to backend | done when: opening Tauri app starts backend process; closing app terminates backend cleanly
- [ ] TASK-077 | reviewer | depends:TASK-075,TASK-076 | Review Tauri config: fs scope restrictions, backend process lifecycle, window configuration | done when: backend process does not outlive Tauri window; fs scope in tauri.conf.json matches workspace restriction requirement

---

## Phase 12 — Integration + E2E

- [ ] TASK-078 | executor | depends:TASK-077 | Integration test: start full stack (OpenClaude + Ollama + backend), send "list files in workspace" message, verify file list appears in chat response | done when: test passes without manual intervention
- [ ] TASK-079 | executor | depends:TASK-077 | Integration test: send "write hello world to test.txt", verify confirmation dialog appears, approve, verify file created in workspace | done when: test passes; file exists after approval; file does not exist if denied
- [ ] TASK-080 | executor | depends:TASK-077 | Integration test: modify a vault file, verify LanceDB re-indexes within 2s, verify subsequent memory search returns updated content | done when: test passes; chunk with updated content appears in search results
- [ ] TASK-081 | executor | depends:TASK-077 | Integration test: trigger planner with goal "build a REST API", verify all 3 planning files created in workspace with correct format | done when: requirements.md, design.md, tasks.md exist; tasks.md contains at least one TASK-NNN entry
- [ ] TASK-082 | executor | depends:TASK-077 | Integration test: trigger reversa-ingest tool, verify .agents/skills/ contents indexed, verify search-memory returns reversa-sourced chunks | done when: chunks with source="reversa" returned by memory search
- [ ] TASK-083 | reviewer | depends:TASK-078,TASK-079,TASK-080,TASK-081,TASK-082 | Final review: all integration tests pass; no memory leaks in long conversations; streaming terminates cleanly on cancel | done when: all 5 integration tests pass in CI; no process handles leaked after cancel

---

## Phase 13 — Scripts + Distribution

- [ ] TASK-084 | coder | depends:TASK-083 | Create `scripts/start-openclaude.sh`: checks OpenClaude installed, starts gRPC server on :50051, waits for ready, exits with code 1 if startup fails after 30s | done when: script starts OpenClaude and exits 0; exits 1 if port 50051 unreachable after 30s
- [ ] TASK-085 | coder | depends:TASK-083 | Create `scripts/health-check.sh`: calls GET /api/health, prints status of each service, exits 0 if all ok, exits 1 if any unhealthy | done when: script exits 0 with full stack running; exits 1 when Ollama is stopped
- [ ] TASK-086 | coder | depends:TASK-085 | Add root `package.json` scripts: `dev` (starts backend + openclaude + ui in parallel), `build` (pnpm build all packages), `health` (runs health-check.sh) | done when: `pnpm dev` brings up full stack; `pnpm health` reports all services healthy

---

## In Progress

*(move tasks here when starting)*

---

## Done

*(move tasks here when criterion verified)*
