# Design — Clover Local AI Assistant

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     TAURI SHELL                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │                   React UI                         │  │
│  │   Chat | FileExplorer | Terminal | AgentPanel      │  │
│  │              ConfirmDialog | ModelSelector          │  │
│  └────────────────────┬──────────────────────────────┘  │
└───────────────────────┼─────────────────────────────────┘
                        │ HTTP REST + WebSocket
                        │ (localhost:3001 only)
┌───────────────────────▼─────────────────────────────────┐
│                  Node.js BACKEND                         │
│                                                          │
│  Gateway (Fastify HTTP + WebSocket)                      │
│       │                                                  │
│  Orchestrator ──────► Agent Engine                       │
│       │                    │                             │
│  Session Manager    Tool Registry ──► plugins/*.tool.ts  │
│  (SQLite)                  │                             │
│                     ┌──────┼──────┐                      │
│                 Memory   Search  Exec Guard              │
│                 Service  Service  (subprocess)           │
│                 (LanceDB  (DDG /                         │
│                 +Obsidian) Offline)                      │
│                                                          │
│  Confirmation Bus (WS bridge for destructive ops)        │
│  Planner Service (generates planning docs)               │
└──────────────────────────┬──────────────────────────────┘
                           │ gRPC (port 50051)
                  ┌────────▼──────────┐
                  │  OpenClaude gRPC  │
                  │  Service          │
                  └────────┬──────────┘
                           │ HTTP (port 11434)
                  ┌────────▼──────────┐
                  │     Ollama        │
                  │  (inference +     │
                  │   embeddings)     │
                  └───────────────────┘
```

---

## Technology Decisions

| Decision | Choice | Justification |
|----------|--------|---------------|
| Desktop shell | Tauri | ~10x smaller binary than Electron; no Node.js bundled; Rust-based filesystem sandbox; active maintenance |
| Vector DB | LanceDB (embedded) | Embedded in Node.js process — no server, no Docker; native Node.js API via `vectordb` package; production-grade performance |
| Session persistence | SQLite via `better-sqlite3` | Embedded, zero-config, transactional, standard for single-user desktop |
| HTTP framework | Fastify | Faster serialization than Express; native schema validation; `@fastify/websocket` plugin mature |
| Monorepo | pnpm workspaces | Shared `types/` and `protos/` between ui and backend without publishing packages |
| gRPC client | `@grpc/grpc-js` | Pure Node.js, no native binaries; official gRPC library |
| Text chunking | `tiktoken` | Token-accurate chunking matching model tokenizer (prevents context window overflow) |
| State management (UI) | Zustand | Minimal boilerplate; no Redux complexity for single-user app |
| Online search | DuckDuckGo adapter | Free, no API key for v1; adapter pattern allows swap to Brave/Tavily without callers changing |
| Nomad replacement | LanceDB offline adapter | Avoids Docker; same semantic search capability; reuses same LanceDB instance already embedded |

---

## Components

| Component | Location | Responsibility | Depends On |
|-----------|----------|----------------|-----------|
| React UI | `apps/ui/src/` | Render all user-facing panels; communicate via HTTP+WS only | `http.client`, `ws.client`, Zustand stores |
| Tauri Shell | `apps/ui/src-tauri/` | Native window; filesystem allowlist enforcement | OS |
| Gateway | `apps/backend/src/gateway/` | Fastify HTTP server + WS server; route requests to orchestrator; emit WS events | Fastify, `orchestrator` |
| Orchestrator | `apps/backend/src/orchestrator/` | Build session context; call memory search; dispatch to agent engine | `session.manager`, `memory.service`, `agent-engine` |
| Session Manager | `apps/backend/src/orchestrator/session.manager.ts` | Load/save conversation history from SQLite; build context window | `sqlite.store` |
| Agent Engine | `apps/backend/src/agents/agent-engine.ts` | Select agent by intent; manage lifecycle; intercept tool_calls; emit status events | all agents, `tool-registry`, `openclaude.client` |
| Agents (×6) | `apps/backend/src/agents/*.agent.ts` | System prompt + tool allowlist + intent matcher per agent type | `tool-registry`, `openclaude.client` |
| Tool Registry | `apps/backend/src/tools/tool-registry.ts` | Auto-discover plugins; validate args with Zod; check confirmation requirement; route execution | `confirmation.bus`, plugin files |
| Tool Plugins (×9) | `apps/backend/src/tools/plugins/` | One file per tool; implements `ToolPlugin` interface | `exec-guard`, `memory.service`, `search.service` |
| Memory Service | `apps/backend/src/memory/memory.service.ts` | Public interface for all memory ops; coordinates sub-adapters | `lancedb.adapter`, `obsidian.adapter`, `embedder`, `chunker`, `vault.watcher` |
| LanceDB Adapter | `apps/backend/src/memory/lancedb.adapter.ts` | Insert/upsert/search vectors in LanceDB | LanceDB SDK |
| Obsidian Adapter | `apps/backend/src/memory/obsidian.adapter.ts` | Read/write markdown files with safety rules; backup before overwrite | Node.js `fs` |
| Embedder | `apps/backend/src/memory/embedder.ts` | Convert text to float[] via Ollama `/api/embeddings` | `ollama.client` |
| Chunker | `apps/backend/src/memory/chunker.ts` | Split text into chunks (512 tokens, 50 overlap) | `tiktoken` |
| Vault Watcher | `apps/backend/src/memory/vault.watcher.ts` | `fs.watch` on vault path; trigger incremental re-index on change | `memory.service` |
| Search Service | `apps/backend/src/search/search.service.ts` | Unified search interface; auto-select adapter by connectivity | `duckduckgo.adapter`, `offline.adapter`, `connectivity.check` |
| DuckDuckGo Adapter | `apps/backend/src/search/duckduckgo.adapter.ts` | Implements `SearchAdapter`; queries DuckDuckGo | node-fetch |
| Offline Adapter | `apps/backend/src/search/offline.adapter.ts` | Implements `SearchAdapter`; cosine search in LanceDB knowledge index | `lancedb.adapter` |
| Connectivity Check | `apps/backend/src/search/connectivity.check.ts` | HEAD request to reliable endpoint; returns boolean | node-fetch |
| Exec Guard | `apps/backend/src/exec-guard/exec-guard.ts` | `child_process.spawn` with cwd=workspace, timeout=30s, deny-list enforcement | Node.js `child_process` |
| Deny List | `apps/backend/src/exec-guard/deny-list.ts` | Blocked command patterns: `rm -rf /`, `format`, `mkfs`, `dd if=` | — |
| Confirmation Bus | `apps/backend/src/confirmation/confirmation.bus.ts` | Emit `confirmation:request` via WS; await `confirmation:response` Promise (60s timeout) | `ws.server` |
| Planner Service | `apps/backend/src/planner/planner.service.ts` | Orchestrate 4-phase planning pipeline; write planning docs | `openclaude.client`, `memory.service`, `obsidian.adapter` |
| Planning Templates | `apps/backend/src/planner/templates/` | requirements.prompt.ts, design.prompt.ts, tasks.prompt.ts | — |
| OpenClaude Client | `apps/backend/src/openclaude/openclaude.client.ts` | gRPC client for OpenClaude :50051; streaming; reconnection | `@grpc/grpc-js` |
| Ollama Client | `apps/backend/src/ollama/ollama.client.ts` | HTTP client for Ollama :11434 (chat, embeddings, model list); retry | node-fetch |
| SQLite Store | `apps/backend/src/storage/sqlite.store.ts` | Session CRUD; message history; tool execution audit log | `better-sqlite3` |
| Config | `apps/backend/src/config/config.ts` | Load `default.config.json` + env var overrides; typed config object | — |
| Shared Types | `shared/types/` | TypeScript interfaces for all inter-module contracts | — |
| Protobuf Definitions | `shared/protos/openclaude.proto` | gRPC message and service definitions | — |

---

## Data Flow

### User message → streamed AI response (with tool call)

```
1.  User types → chat.store.sendMessage()
2.  ws.client emits: { type:"chat:send", sessionId, content }
3.  gateway/ws.server → orchestrator.handle(sessionId, content)
4.  orchestrator:
      session.manager.loadHistory(sessionId)   → last-N messages from SQLite
      memory.service.search(content, topK=5)   → relevant LanceDB chunks
      builds CompletionRequest:
        messages = [system] + [memory_chunks] + [history] + [user_message]
        tools    = tool-registry.listAll()
        model    = config.activeModel
5.  agent-engine.dispatch(request, sessionId)
6.  agent-engine.matchIntent() → selects agent (e.g. CoderAgent)
7.  WS emit: { type:"agent:status", agent:"coder", status:"running" }
8.  agent calls openclaude.client.streamComplete(CompletionRequest)
9.  gRPC stream opens → OpenClaude :50051 → Ollama :11434
10. tokens stream back: Ollama → gRPC → openclaude.client → agent-engine → gateway → WS → UI
11. UI renders tokens progressively (StreamingCursor)

    [IF AI EMITS TOOL_CALL]
12. agent-engine intercepts CompletionChunk.tool_call (not a token)
13. tool-registry.execute(toolName, args, context)
14. tool-registry validates args with Zod schema
15. IF requiresConfirmation(args) = true:
      confirmation.bus.request({ requestId, toolName, args })
      WS emit: { type:"confirmation:request", requestId, operation, details }
      UI shows ConfirmDialog — blocks until user responds
      WS receives: { type:"confirmation:response", requestId, approved }
      IF denied → ToolResult { error:"user_denied" } → injected as tool_result message
16. IF approved (or confirmation not required):
      plugin.execute(args, ctx)
      result captured as ToolResult
      WS emit: { type:"tool:result", toolName, result }
17. agent-engine injects tool_result as Message{ role:"tool" } into context
18. gRPC stream resumes → AI continues generation

    [COMPLETION]
19. gRPC stream closes
20. WS emit: { type:"message:done", sessionId, usage }
21. orchestrator saves turn to SQLite
22. memory.service.indexText(turn) → chunk → embed → LanceDB
23. WS emit: { type:"agent:status", agent:"coder", status:"done" }
```

### Memory write path (indexing)

```
Trigger A — conversation turn saved (step 22 above):
  memory.service.indexText(text, { source:"conversation", sessionId })
  chunker.split(text) → chunks[]
  for each chunk: embedder.embed(chunk) → ollama POST /api/embeddings → float[]
  lancedb.adapter.insert({ id, source, text, vector, timestamp, sessionId })

Trigger B — vault file changed (vault.watcher):
  memory.service.indexFile(filePath)
  obsidian.adapter.read(filePath) → markdown string
  chunker.split(markdown) → chunks[]
  lancedb.adapter.upsert(chunks)  ← removes old chunks for same path first

Trigger C — Reversa ingestion triggered by user:
  reversa-ingest.tool called
  memory.service.ingestDirectory(".agents/skills/")
  memory.service.indexFile("CLAUDE.md")
  all chunks tagged source:"reversa"
```

### Memory read path (RAG retrieval)

```
orchestrator calls memory.service.search(query, topK=5)
embedder.embed(query) → queryVector
lancedb.adapter.similaritySearch(queryVector, topK) → Chunk[] sorted by score DESC
chunks formatted as "## Context" block and prepended to system prompt
```

### Obsidian vault write rules

```
mode = "create-only"  → fail if file exists (never silent overwrite)
mode = "append"       → read existing + append with separator; no confirmation needed
mode = "overwrite"    → ALWAYS requires confirmation.bus approval first
                      → obsidian.adapter copies file to .bak before writing
```

---

## Contracts / Interfaces

### HTTP REST (localhost:3001)

```
POST   /api/sessions                     body: { workspacePath }      → { sessionId, createdAt }
GET    /api/sessions/:id/history                                       → Message[]
DELETE /api/sessions/:id                                               → 204

POST   /api/chat/message                 body: { sessionId, content } → 202 { queued:true }

GET    /api/files?path=                                                → { content, mtime, size }
POST   /api/files                        body: { path, content }      → 201 | 409
PATCH  /api/files                        body: { path, operations }   → 200 { linesChanged }
DELETE /api/files                        body: { path }               → 200 | 403

GET    /api/filesystem/tree?root=&depth=                              → FileNode[]

POST   /api/terminal/sessions            body: { sessionId }          → { terminalId }
DELETE /api/terminal/sessions/:id                                      → 204

GET    /api/memory/search?q=&topK=&source=                            → Chunk[]
POST   /api/memory/ingest                body: { path }               → 202 { taskId }

POST   /api/planner/generate             body: { goal, workspacePath }→ 202 { taskId }

GET    /api/models                                                     → OllamaModel[]
PATCH  /api/config/model                 body: { model }              → 200

GET    /api/health                                                     → { openclaude, ollama, lancedb, sqlite }
```

### WebSocket Events

```typescript
// Backend → UI
{ type: "message:token",          data: { sessionId, token: string } }
{ type: "message:done",           data: { sessionId, usage: { inputTokens, outputTokens } } }
{ type: "message:error",          data: { sessionId, error: string } }
{ type: "agent:status",           data: { agent, status: "idle"|"running"|"done"|"error", detail? } }
{ type: "tool:executing",         data: { toolName, args } }
{ type: "tool:result",            data: { toolName, success, output } }
{ type: "terminal:output",        data: { terminalId, chunk, stream: "stdout"|"stderr" } }
{ type: "terminal:exit",          data: { terminalId, exitCode } }
{ type: "confirmation:request",   data: { requestId, toolName, operation, details, args } }
{ type: "memory:indexed",         data: { source, chunks, path? } }
{ type: "planner:progress",       data: { phase: "requirements"|"design"|"tasks", status } }
{ type: "planner:done",           data: { files: string[] } }

// UI → Backend
{ type: "chat:send",              data: { sessionId, content } }
{ type: "terminal:input",         data: { terminalId, input } }
{ type: "confirmation:response",  data: { requestId, approved: boolean } }
{ type: "agent:cancel",           data: { sessionId } }
```

### gRPC Service (openclaude.proto)

```protobuf
service CompletionService {
  rpc StreamComplete (CompletionRequest) returns (stream CompletionChunk);
  rpc Complete       (CompletionRequest) returns (CompletionResponse);
}
// Full proto in shared/protos/openclaude.proto
// Key messages: CompletionRequest, CompletionChunk (token|tool_call|usage), Message, Tool, ToolCall
```

### ToolPlugin Interface

```typescript
interface ToolPlugin {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  requiresConfirmation: (args: unknown) => boolean;
  execute: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
}
// ctx provides: workspacePath, sessionId, execGuard, emitEvent
```

### SearchAdapter Interface

```typescript
interface SearchAdapter {
  name: string;
  isAvailable(): Promise<boolean>;
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}
// Swap provider by implementing this + 1-line registration in search.service.ts
```

---

## Project Structure

```
clover/
├── apps/
│   ├── ui/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── Chat/           ChatWindow, MessageBubble, StreamingCursor
│   │   │   │   ├── FileExplorer/   FileTree, FilePreview
│   │   │   │   ├── Terminal/       TerminalPane (xterm.js)
│   │   │   │   ├── AgentPanel/     AgentStatusList, TaskProgress
│   │   │   │   ├── ConfirmDialog/  ConfirmDialog
│   │   │   │   └── ModelSelector/  ModelSelector
│   │   │   ├── store/              chat.store, agent.store, session.store (Zustand)
│   │   │   ├── api/                http.client, ws.client
│   │   │   └── App.tsx
│   │   ├── src-tauri/              main.rs, tauri.conf.json (fs allowlist)
│   │   └── package.json
│   │
│   └── backend/
│       ├── src/
│       │   ├── gateway/            http.server, ws.server, routes/
│       │   ├── orchestrator/       orchestrator, session.manager
│       │   ├── agents/             agent-engine, *.agent (×6)
│       │   ├── tools/              tool-registry, plugins/ (×9 tools)
│       │   ├── memory/             memory.service, lancedb.adapter,
│       │   │                       obsidian.adapter, embedder, chunker, vault.watcher
│       │   ├── search/             search.service, duckduckgo.adapter,
│       │   │                       offline.adapter, connectivity.check
│       │   ├── exec-guard/         exec-guard, deny-list
│       │   ├── confirmation/       confirmation.bus
│       │   ├── planner/            planner.service, templates/ (×3 prompts)
│       │   ├── openclaude/         openclaude.client
│       │   ├── ollama/             ollama.client
│       │   ├── storage/            sqlite.store
│       │   └── config/             config, default.config
│       └── package.json
│
├── shared/
│   ├── types/                      messages, tools, agents, memory, search
│   └── protos/                     openclaude.proto
│
├── config/
│   ├── default.config.json
│   └── models.config.json
│
├── scripts/
│   ├── start-openclaude.sh
│   └── health-check.sh
│
├── requirements.md                 ← this file's sibling
├── design.md                       ← this file
├── tasks.md                        ← execution plan
└── package.json                    (pnpm workspaces root)
```

---

## Planner System (self-referential)

When user triggers `/plan <goal>`, PlannerAgent runs 4 phases:

```
Phase 1 — Context: scan workspace files + RAG search + Reversa context if present
Phase 2 — requirements.md: strict format (FR/NF/Constraints/OutOfScope tables)
Phase 3 — design.md: architecture + components + data flow + contracts + structure
Phase 4 — tasks.md: atomic tasks, TASK-NNN format, agent assignment, dependencies, acceptance criterion
```

Each file written via `obsidian.adapter.writeNote(path, content, "create-only")`.
If file exists, user confirmation required before overwrite.
`tasks.md` checkboxes updated via `edit-file.tool` patch (never full rewrite).

---

## Dependency Rules

```
shared/          ← no imports from apps/
apps/ui/         ← imports only from shared/types/; never from apps/backend/
apps/backend/    ← imports from shared/ only (not from apps/ui/)

Within backend (one-way only):
  gateway → orchestrator → agents → tools / memory / search
  tools → exec-guard / memory.service / search.service
  memory.service → lancedb.adapter, obsidian.adapter, embedder, chunker
  NO module imports its caller
```

---

## Extensibility Surface

| What | Where | Code changes required |
|------|-------|-----------------------|
| New tool | `tools/plugins/*.tool.ts` | None — auto-discovered |
| New Ollama model | `config/models.config.json` | None |
| New search provider | `search/*.adapter.ts` + registration in `search.service.ts` | 1 line |
| New agent | `agents/*.agent.ts` + registration in `agent-engine.ts` | 1 line |
| New embed model | `models.config.json` with `capabilities:["embed"]` | None |
