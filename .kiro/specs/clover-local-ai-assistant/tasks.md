# Implementation Plan: Clover Local AI Assistant

## Overview

This plan breaks the Clover Local AI Assistant into incremental implementation tasks organized by system layer. Each task builds on previous ones, starting from the monorepo scaffold and shared types, through backend services, to the React UI and Tauri desktop shell. The stack is TypeScript throughout: React + Tauri (UI), Node.js + Fastify (backend), OpenClaude gRPC (AI core), Ollama (inference/embeddings), LanceDB embedded (vector memory), SQLite (sessions), and DuckDuckGo (online search).

## Tasks

- [x] 1. Set up monorepo scaffold and shared packages
  - [x] 1.1 Initialize pnpm workspaces monorepo with `apps/ui`, `apps/backend`, `shared` packages
    - Create root `package.json` with pnpm workspaces config pointing to `apps/*` and `shared`
    - Create `apps/ui/package.json` (React + Tauri dependencies), `apps/backend/package.json` (Fastify, better-sqlite3, vectordb, grpc-js, tiktoken), `shared/package.json`
    - Configure root `tsconfig.json` with project references for all packages
    - Verify `pnpm install` succeeds at root and each package resolves its dependencies
    - _Requirements: 29.1, 29.2, 29.3, 30.1, 34.1_

  - [x] 1.2 Create shared TypeScript interfaces in `shared/types/`
    - Create `shared/types/messages.ts` with Message, CompletionRequest, CompletionChunk, UsageStats interfaces
    - Create `shared/types/tools.ts` with ToolPlugin, ToolContext, ToolResult, ToolCall interfaces
    - Create `shared/types/agents.ts` with Agent, AgentContext, AgentStatus interfaces
    - Create `shared/types/memory.ts` with Chunk, VectorChunk, MemorySearchOptions interfaces
    - Create `shared/types/search.ts` with SearchAdapter, SearchOptions, SearchResult interfaces
    - Create `shared/types/config.ts` with Config, ModelConfig interfaces
    - Create `shared/types/index.ts` barrel export
    - Ensure no `any` types; verify with `tsc --noEmit`
    - _Requirements: 34.1, 34.4, 29.1_

  - [x] 1.3 Create protobuf definitions and generate TypeScript stubs
    - Create `shared/protos/openclaude.proto` with CompletionService (StreamComplete, Complete RPCs), CompletionRequest, CompletionChunk (token | tool_call | usage), Message, Tool, ToolCall, UsageStats
    - Generate TypeScript stubs into `shared/protos/generated/` using `grpc_tools_node_protoc`
    - Verify generated `*_grpc_pb.d.ts` and `*_pb.d.ts` files are importable from backend
    - _Requirements: 34.2, 34.3_

  - [x] 1.4 Create configuration files
    - Create `config/default.config.json` with gateway (port 3001, host localhost, corsOrigin), openclaude (host, port 50051), ollama (host, retryAttempts 3, retryBackoffMs 1000), memory (dbPath, topK 5, chunkSize 512, chunkOverlap 50), vault (path, watchDebounceMs 500), execGuard (timeoutMs 30000), confirmation (timeoutMs 60000), session (historyLimit 20)
    - Create `config/models.config.json` with at least one model with `capabilities:["chat"]` and one with `capabilities:["embed"]`
    - _Requirements: 33.1, 33.4_

  - [x] 1.5 Write unit tests for shared types compilation
    - Verify all interfaces compile with strict TypeScript
    - Verify proto stubs are importable
    - _Requirements: 34.1, 34.3_

- [x] 2. Checkpoint - Verify monorepo scaffold
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement backend foundation services
  - [x] 3.1 Create Config module
    - Create `apps/backend/src/config/config.ts` that loads `config/default.config.json` at startup
    - Implement environment variable overrides for any config value (e.g., `CLOVER_GATEWAY_PORT` overrides `gateway.port`)
    - Export a typed `Config` object matching the Config interface from shared/types
    - _Requirements: 33.1, 33.2, 33.3_

  - [x] 3.2 Create SQLite Store
    - Create `apps/backend/src/storage/sqlite.store.ts` using `better-sqlite3`
    - Implement schema creation: sessions table (id, workspace, model, created_at, updated_at), messages table (id, session_id, role, content, tool_name, tool_call_id, created_at), tool_executions table (id, session_id, tool_name, args, result, success, duration_ms, created_at)
    - Implement methods: createSession(workspacePath), getSession(id), deleteSession(id), saveMessage(sessionId, message), getHistory(sessionId, limit), logToolExecution(sessionId, toolName, args, result, success, durationMs)
    - _Requirements: 9.1, 9.3, 9.5_

  - [x] 3.3 Write unit tests for SQLite Store
    - Test createSession, saveMessage, getHistory ordering, deleteSession cascade
    - _Requirements: 9.1, 9.3, 9.5_

  - [x] 3.4 Create Ollama Client
    - Create `apps/backend/src/ollama/ollama.client.ts` with HTTP client for Ollama at port 11434
    - Implement methods: chat(messages, model), embed(text, model), listModels()
    - Implement retry logic: 3 attempts with 1-second exponential backoff
    - Throw typed errors when Ollama is unreachable
    - _Requirements: 27.4, 20.1, 10.5_

  - [x] 3.5 Create OpenClaude gRPC Client
    - Create `apps/backend/src/openclaude/openclaude.client.ts` using `@grpc/grpc-js`
    - Implement streamComplete(request) returning AsyncIterable<CompletionChunk> for streaming responses
    - Implement complete(request) returning CompletionResponse for non-streaming calls
    - Implement automatic reconnection on gRPC connection loss
    - _Requirements: 1.3, 1.4, 1.5, 27.1_

  - [x] 3.6 Write unit tests for Ollama Client retry logic
    - Test retry behavior on transient failures
    - Test typed error on permanent failure
    - _Requirements: 27.4_

- [x] 4. Implement memory system
  - [x] 4.1 Create Chunker
    - Create `apps/backend/src/memory/chunker.ts` using `tiktoken`
    - Implement split(text) returning Chunk[] with 512 token chunks and 50 token overlap
    - Preserve sentence boundaries where possible during splitting
    - _Requirements: 10.4_

  - [x] 4.2 Create Embedder
    - Create `apps/backend/src/memory/embedder.ts`
    - Implement embed(text) returning float[] by calling ollama.client with configured embed model
    - Stateless — no caching
    - _Requirements: 10.5_

  - [x] 4.3 Create LanceDB Adapter
    - Create `apps/backend/src/memory/lancedb.adapter.ts` using LanceDB SDK (`vectordb` package)
    - Implement init(dbPath) to initialize embedded LanceDB instance
    - Implement insert(chunks) for batch vector insertion
    - Implement upsertByPath(path, chunks) that removes old chunks for the same file path before inserting new ones
    - Implement similaritySearch(vector, topK, filter?) returning Chunk[] sorted by score descending
    - _Requirements: 10.1, 10.3, 11.3_

  - [x] 4.4 Create Obsidian Adapter
    - Create `apps/backend/src/memory/obsidian.adapter.ts`
    - Implement read(filePath) to read markdown files from vault
    - Implement writeNote(filePath, content, mode) with three modes:
      - "create-only": create file only if it does not exist; return error if file exists
      - "append": append content with separator to existing file; no confirmation needed
      - "overwrite": requires confirmation via Confirmation Bus; creates .bak backup before writing
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 14.1, 14.2_

  - [x] 4.5 Create Memory Service
    - Create `apps/backend/src/memory/memory.service.ts` implementing MemoryService interface
    - Implement search(query, topK, filter?) that embeds query and calls lancedb.adapter.similaritySearch
    - Implement indexText(text, metadata) that chunks text, embeds each chunk, and inserts into LanceDB
    - Implement indexFile(filePath) that reads file via obsidian.adapter, chunks, embeds, and upserts by path
    - Implement ingestDirectory(dirPath) that indexes all files in directory with source tag
    - Implement writeNote(filePath, content, mode) delegating to obsidian.adapter
    - _Requirements: 10.1, 10.2, 10.3, 13.1, 13.2, 13.3_

  - [x] 4.6 Create Vault Watcher
    - Create `apps/backend/src/memory/vault.watcher.ts`
    - Implement fs.watch on configured vault path
    - Debounce file change events with 500ms window
    - Call memory.service.indexFile on change events for incremental re-indexing
    - Emit `memory:indexed` WebSocket event after successful indexing
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 4.7 Write unit tests for Chunker
    - Test chunk size does not exceed 512 tokens per tiktoken count
    - Test overlap between consecutive chunks
    - Test sentence boundary preservation
    - _Requirements: 10.4_

  - [x] 4.8 Write unit tests for Obsidian Adapter write safety
    - Test create-only mode fails on existing file
    - Test overwrite mode creates .bak backup
    - Test append mode appends with separator
    - _Requirements: 12.1, 12.2, 12.3, 12.5_

- [x] 5. Checkpoint - Verify memory system
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement search system
  - [x] 6.1 Create Connectivity Check
    - Create `apps/backend/src/search/connectivity.check.ts`
    - Implement isOnline() returning Promise<boolean> via HEAD request with 2-second timeout
    - _Requirements: 14.3, 15.1_

  - [x] 6.2 Create DuckDuckGo Adapter
    - Create `apps/backend/src/search/duckduckgo.adapter.ts` implementing SearchAdapter interface
    - Set name="duckduckgo", isAvailable() delegates to connectivity.check.isOnline()
    - Implement search(query, options) returning SearchResult[] with title, url, snippet
    - _Requirements: 14.1, 14.2, 16.2_

  - [x] 6.3 Create Offline Adapter
    - Create `apps/backend/src/search/offline.adapter.ts` implementing SearchAdapter interface
    - Set name="offline", isAvailable() always returns true (embedded LanceDB)
    - Implement search(query, options) that embeds query and performs cosine similarity search in LanceDB knowledge index
    - _Requirements: 15.1, 15.3, 16.2_

  - [x] 6.4 Create Search Service
    - Create `apps/backend/src/search/search.service.ts`
    - Maintain ordered priority list of SearchAdapter instances (DuckDuckGo first, Offline second)
    - Implement search(query, options) that checks isAvailable() on each adapter in priority order and uses the first available
    - Support registering new adapters with one-line registration
    - _Requirements: 15.2, 16.1, 16.2, 16.3_

  - [x] 6.5 Write unit tests for Search Service fallback
    - Test online adapter used when available
    - Test automatic fallback to offline adapter when DuckDuckGo unavailable
    - Test adapter registration
    - _Requirements: 15.1, 15.2, 16.1_

- [x] 7. Implement exec guard and confirmation bus
  - [x] 7.1 Create Deny List
    - Create `apps/backend/src/exec-guard/deny-list.ts`
    - Define regex patterns blocking: `rm -rf /`, `format`, `mkfs`, `dd if=`, fork bomb variants `:(){ :|:& };:`
    - Ensure patterns do NOT block standard dev commands: `rm ./file.txt`, `npm run build`, `git status`
    - _Requirements: 6.4, 6.5, 6.6, 32.1, 32.4_

  - [x] 7.2 Create Exec Guard
    - Create `apps/backend/src/exec-guard/exec-guard.ts`
    - Implement run(cmd, opts: { cwd, timeout }) returning { stdout, stderr, exitCode }
    - Use child_process.spawn with cwd restricted to workspace path
    - Check deny-list before spawning; throw DeniedCommandError if matched
    - Enforce configurable timeout (default 30s); terminate subprocess on timeout
    - Stream stdout/stderr via callback for real-time output
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 32.1, 32.2, 32.3_

  - [x] 7.3 Create Confirmation Bus
    - Create `apps/backend/src/confirmation/confirmation.bus.ts`
    - Implement request(data) returning Promise<boolean>
    - Store pending requests by requestId; resolve when matching `confirmation:response` received via WebSocket
    - Reject with TimeoutError after 60 seconds if no response
    - _Requirements: 19.1, 19.5, 4.1_

  - [x] 7.4 Write unit tests for Deny List
    - Test all blocked patterns are matched
    - Test common dev commands are NOT blocked (no false positives)
    - _Requirements: 6.5, 6.6, 32.4_

  - [x] 7.5 Write unit tests for Confirmation Bus timeout
    - Test approval resolves true
    - Test denial resolves false
    - Test 60s timeout rejects with TimeoutError
    - _Requirements: 19.3, 19.4, 19.5_

- [x] 8. Implement tool registry and plugins
  - [x] 8.1 Create Tool Registry
    - Create `apps/backend/src/tools/tool-registry.ts`
    - Implement loadPlugins() that auto-discovers all `*.tool.ts` files in `plugins/` directory via glob pattern
    - Implement execute(name, args, ctx) that validates args with Zod schema, checks requiresConfirmation, routes to confirmation.bus if needed, then calls plugin.execute
    - Return typed validation error on Zod failure without executing the tool
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 23.1, 23.2, 23.3_

  - [x] 8.2 Create read-file plugin
    - Create `apps/backend/src/tools/plugins/read-file.tool.ts`
    - Read file content at path within workspace; validate path stays within workspacePath
    - requiresConfirmation always returns false
    - Throw WorkspaceBoundaryError if path is outside workspace
    - _Requirements: 3.1, 3.6_

  - [x] 8.3 Create write-file plugin
    - Create `apps/backend/src/tools/plugins/write-file.tool.ts`
    - Write file content; requiresConfirmation returns true if file already exists (overwrite case)
    - New file creation does not require confirmation
    - _Requirements: 3.2, 3.3, 3.6_

  - [x] 8.4 Create edit-file plugin
    - Create `apps/backend/src/tools/plugins/edit-file.tool.ts`
    - Implement patch editing via string replacement or line-range replacement (never full file rewrite)
    - Throw AmbiguousMatchError if pattern matches multiple locations
    - requiresConfirmation always returns false
    - Support patching tasks.md checkboxes (string replacement on specific checkbox line)
    - _Requirements: 3.4, 3.5, 18.1, 18.2_

  - [x] 8.5 Create delete-file plugin
    - Create `apps/backend/src/tools/plugins/delete-file.tool.ts`
    - Delete file within workspace; requiresConfirmation always returns true
    - Return `user_denied` if user denies deletion
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 8.6 Create list-files plugin
    - Create `apps/backend/src/tools/plugins/list-files.tool.ts`
    - List directory entries with name, type, size, mtime; support depth parameter (default 1)
    - requiresConfirmation always returns false
    - _Requirements: 2.1, 2.3, 2.4_

  - [x] 8.7 Create execute-command plugin
    - Create `apps/backend/src/tools/plugins/execute-command.tool.ts`
    - Run command via exec-guard; requiresConfirmation always returns true
    - Stream output chunks via ctx.emitEvent as `terminal:output` WebSocket events
    - _Requirements: 6.1, 6.2, 6.3, 6.7, 25.1_

  - [x] 8.8 Create search-online plugin
    - Create `apps/backend/src/tools/plugins/search-online.tool.ts`
    - Call search.service.search(query); requiresConfirmation always returns false
    - Return SearchResult[] formatted as string; transparently handles online/offline fallback
    - _Requirements: 14.1, 15.1, 20.1_

  - [x] 8.9 Create search-memory plugin
    - Create `apps/backend/src/tools/plugins/search-memory.tool.ts`
    - Call memory.service.search(query, topK, filter); requiresConfirmation always returns false
    - Return Chunk[] with source, text, score fields
    - _Requirements: 10.1, 13.4_

  - [x] 8.10 Create memory-write plugin
    - Create `apps/backend/src/tools/plugins/memory-write.tool.ts`
    - Call memory.service.writeNote; requiresConfirmation returns true for mode="overwrite", false for "append" and "create-only"
    - _Requirements: 12.1, 12.3, 12.4, 12.6_

  - [x] 8.11 Create reversa-ingest plugin
    - Create `apps/backend/src/tools/plugins/reversa-ingest.tool.ts`
    - Call memory.service.ingestDirectory(".agents/skills/") and memory.service.indexFile("CLAUDE.md") if exists
    - Tag all chunks with source="reversa"; requiresConfirmation always returns false
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 8.12 Write unit tests for Tool Registry
    - Test auto-discovery of plugin files
    - Test Zod validation failure returns typed error
    - Test confirmation flow integration
    - _Requirements: 22.1, 22.3, 22.4, 23.1, 23.2_

  - [x] 8.13 Write unit tests for file operation plugins
    - Test workspace boundary enforcement on read-file and write-file
    - Test AmbiguousMatchError on edit-file
    - Test delete-file confirmation flow
    - _Requirements: 3.5, 3.6, 4.1, 4.3_

- [x] 9. Checkpoint - Verify tools and plugins
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement agent system
  - [x] 10.1 Create Agent interface and base types
    - Ensure `shared/types/agents.ts` defines Agent interface with: name (string), systemPrompt (string), allowedTools (string[]), matchesIntent (function), maxTurns (number) — all required fields
    - _Requirements: 7.1, 28.3_

  - [x] 10.2 Create Coder Agent
    - Create `apps/backend/src/agents/coder.agent.ts`
    - System prompt focused on software implementation and code generation
    - allowedTools: [read-file, write-file, edit-file, list-files, execute-command, search-memory]
    - matchesIntent detects coding, implementation, write, create, fix, refactor requests
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 10.3 Create Reviewer Agent
    - Create `apps/backend/src/agents/reviewer.agent.ts`
    - System prompt focused on code review and quality analysis
    - allowedTools: [read-file, list-files, search-memory]
    - matchesIntent detects review, check, analyze, audit requests
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 10.4 Create Executor Agent
    - Create `apps/backend/src/agents/executor.agent.ts`
    - System prompt focused on running commands, builds, and tests
    - allowedTools: [execute-command, list-files, read-file]
    - matchesIntent detects run, execute, test, build, deploy requests
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 10.5 Create Researcher Agent
    - Create `apps/backend/src/agents/researcher.agent.ts`
    - System prompt focused on information gathering and explanation
    - allowedTools: [search-online, search-memory, read-file]
    - matchesIntent detects research, explain, find, search, what is requests
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 10.6 Create Memory Agent
    - Create `apps/backend/src/agents/memory.agent.ts`
    - System prompt focused on memory management and vault operations
    - allowedTools: [search-memory, memory-write, reversa-ingest]
    - matchesIntent detects remember, save, store, vault, memory requests
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 10.7 Create Planner Agent
    - Create `apps/backend/src/agents/planner.agent.ts`
    - System prompt focused on project planning and document generation
    - allowedTools: [list-files, read-file, search-memory]
    - matchesIntent detects plan, design, requirements, architecture, /plan requests
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 10.8 Create Agent Engine
    - Create `apps/backend/src/agents/agent-engine.ts`
    - Implement loadAgents() that discovers and registers all `*.agent.ts` files
    - Implement dispatch(request, sessionId) that evaluates matchesIntent in priority order and dispatches to first matching agent
    - Intercept tool_call chunks from gRPC stream and route to tool-registry.execute
    - Enforce tool allowlist: reject tool calls not in agent's allowedTools before execution
    - Emit `agent:status` WebSocket events (running, done, error)
    - Support cancel via AbortController that terminates active gRPC stream
    - Support one-line registration for new agents
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 28.1_

  - [x] 10.9 Write unit tests for Agent Engine
    - Test intent routing dispatches to correct agent
    - Test tool allowlist enforcement rejects unauthorized tools
    - Test cancel terminates gRPC stream
    - _Requirements: 7.2, 7.4, 8.1_

- [x] 11. Implement orchestrator and session manager
  - [x] 11.1 Create Session Manager
    - Create `apps/backend/src/orchestrator/session.manager.ts`
    - Implement createSession(workspacePath) creating session record in SQLite
    - Implement loadHistory(sessionId, limit=20) loading last N messages from SQLite
    - Implement saveMessage(sessionId, message) persisting user and AI messages
    - Implement buildContextWindow(sessionId, memoryChunks) returning Message[] in order: [system_prompt, ...memoryChunks, ...history, userMessage]
    - Persist selected model in session store for survival across page reloads
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 20.3_

  - [x] 11.2 Create Orchestrator
    - Create `apps/backend/src/orchestrator/orchestrator.ts`
    - Implement handle(sessionId, userMessage) that:
      1. Calls session.manager.loadHistory(sessionId)
      2. Calls memory.service.search(userMessage, topK=5) for RAG retrieval
      3. Builds CompletionRequest with system prompt, memory chunks as Context block, conversation history, user message, and tool list from tool-registry
      4. Calls agent-engine.dispatch(request, sessionId)
      5. Saves completed turn to SQLite via session.manager
      6. Indexes turn text to LanceDB via memory.service.indexText
    - _Requirements: 1.1, 1.2, 9.2, 9.3, 10.1, 10.2, 10.3_

  - [x] 11.3 Write unit tests for Session Manager
    - Test context window construction order
    - Test history limit enforcement
    - Test session isolation (sessions don't share history)
    - _Requirements: 9.2, 9.4_

- [x] 12. Checkpoint - Verify agent system and orchestrator
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement gateway (HTTP + WebSocket)
  - [x] 13.1 Create Fastify HTTP server
    - Create `apps/backend/src/gateway/http.server.ts`
    - Initialize Fastify instance on configured port (default 3001)
    - Configure CORS restricted to localhost origin
    - Register all route files
    - Configure Fastify schema validation for all request bodies
    - Ensure all errors return format `{ error: string, code: string }`
    - _Requirements: 24.1, 24.3, 24.4_

  - [x] 13.2 Create WebSocket server
    - Create `apps/backend/src/gateway/ws.server.ts` using `@fastify/websocket`
    - Manage WebSocket connections by sessionId
    - Expose emit(sessionId, event) for broadcasting typed events to connected clients
    - Expose onEvent(type, handler) for receiving typed events from clients
    - Wire confirmation.bus to use WS server for request/response flow
    - _Requirements: 24.2, 1.3, 1.4, 1.5_

  - [x] 13.3 Create chat and session routes
    - Create `apps/backend/src/gateway/routes/chat.routes.ts`
    - `POST /api/chat/message` → calls orchestrator.handle → returns 202 { queued: true }
    - `POST /api/sessions` → creates session with workspacePath → returns { sessionId, createdAt }
    - `GET /api/sessions/:id/history` → returns Message[]
    - `DELETE /api/sessions/:id` → deletes session and history → returns 204
    - _Requirements: 1.1, 9.1, 9.5_

  - [x] 13.4 Create file operation routes
    - Create `apps/backend/src/gateway/routes/files.routes.ts`
    - `GET /api/files?path=` → returns { content, mtime, size }
    - `POST /api/files` → creates file → returns 201 or 409 if exists
    - `PATCH /api/files` → applies patch operations → returns { linesChanged }
    - `DELETE /api/files` → triggers confirmation → returns 200 or 403
    - `GET /api/filesystem/tree?root=&depth=` → returns FileNode[] tree
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1_

  - [x] 13.5 Create memory and search routes
    - Create `apps/backend/src/gateway/routes/memory.routes.ts`
    - `GET /api/memory/search?q=&topK=&source=` → returns Chunk[]
    - `POST /api/memory/ingest` → triggers async ingestion → returns 202 { taskId }; emits `memory:indexed` WS event on completion
    - _Requirements: 10.1, 13.1_

  - [x] 13.6 Create terminal routes
    - Create `apps/backend/src/gateway/routes/terminal.routes.ts`
    - `POST /api/terminal/sessions` → creates terminal session → returns { terminalId }
    - `DELETE /api/terminal/sessions/:id` → terminates terminal → returns 204
    - Wire WebSocket events: `terminal:input` from UI, `terminal:output` and `terminal:exit` to UI
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 13.7 Create models and health routes
    - Create `apps/backend/src/gateway/routes/models.routes.ts`
    - `GET /api/models` → calls ollama.client.listModels() → returns OllamaModel[]
    - `PATCH /api/config/model` → updates active model in session store → returns 200
    - Create `apps/backend/src/gateway/routes/health.routes.ts`
    - `GET /api/health` → returns status of OpenClaude, Ollama, LanceDB, SQLite as "healthy" or "unhealthy" with descriptive message
    - _Requirements: 20.1, 20.2, 21.1, 21.2_

  - [x] 13.8 Write unit tests for gateway routes
    - Test chat route returns 202
    - Test file routes return correct status codes
    - Test health endpoint reports component statuses
    - Test error responses match `{ error, code }` format
    - _Requirements: 24.3, 24.4, 21.1_

- [x] 14. Implement planner service
  - [x] 14.1 Create planning prompt templates
    - Create `apps/backend/src/planner/templates/requirements.prompt.ts` — template function taking { goal, fileTree, memoryChunks, reversaContext } → string; enforces FR/NF/Constraints/OutOfScope sections
    - Create `apps/backend/src/planner/templates/design.prompt.ts` — takes { goal, requirementsContent, fileTree, memoryChunks } → string; enforces Architecture/Components/DataFlow/Decisions sections
    - Create `apps/backend/src/planner/templates/tasks.prompt.ts` — takes { goal, requirementsContent, designContent } → string; enforces task format `TASK-NNN | agent | depends:X | description | done when: criterion`
    - _Requirements: 17.2, 17.6_

  - [x] 14.2 Create Planner Service
    - Create `apps/backend/src/planner/planner.service.ts`
    - Implement generate(goal, workspacePath) that runs 4 phases:
      1. Context: scan workspace files + RAG search + Reversa context
      2. Requirements: generate via openclaude.client.complete with requirements template
      3. Design: generate with design template using requirements output
      4. Tasks: generate with tasks template using requirements + design output
    - Write each file via obsidian.adapter with mode "create-only" to prevent silent overwrites
    - Emit `planner:progress` WebSocket events for each phase
    - Emit `planner:done` WebSocket event with list of generated file paths
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 14.3 Create planner routes
    - Create `apps/backend/src/gateway/routes/planner.routes.ts`
    - `POST /api/planner/generate` → calls planner.service.generate async → returns 202 { taskId }
    - _Requirements: 17.1_

  - [x] 14.4 Write unit tests for Planner Service
    - Test create-only mode prevents overwriting existing planning files
    - Test all 4 phases emit progress events
    - Test planner:done event includes file paths
    - _Requirements: 17.3, 17.4, 17.5_

- [x] 15. Checkpoint - Verify backend is complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Implement React UI — API layer and stores
  - [x] 16.1 Create WebSocket client
    - Create `apps/ui/src/api/ws.client.ts`
    - Implement WebSocket singleton with typed event emitter
    - Implement auto-reconnect with exponential backoff on connection loss
    - Preserve registered event handlers across reconnections
    - Expose onEvent(type, handler) and emit(type, data) methods
    - _Requirements: 25.2, 27.2, 27.3_

  - [x] 16.2 Create HTTP client
    - Create `apps/ui/src/api/http.client.ts`
    - Implement typed fetch wrapper with base URL from config
    - Implement methods: get, post, patch, delete with typed request/response interfaces
    - Throw typed HttpError on non-2xx responses containing status code and error message
    - _Requirements: 25.1, 25.4_

  - [x] 16.3 Create Zustand stores
    - Create `apps/ui/src/store/chat.store.ts` — sessions, messages, streaming state, sendMessage action
    - Create `apps/ui/src/store/agent.store.ts` — agent status map, active tool calls
    - Create `apps/ui/src/store/session.store.ts` — active session, workspace path, active model
    - All stores use strict TypeScript with no `any` types
    - All stores communicate with backend exclusively through http.client and ws.client
    - _Requirements: 25.3_

  - [x] 16.4 Write unit tests for WebSocket client reconnection
    - Test reconnection preserves event handlers
    - Test exponential backoff timing
    - _Requirements: 27.2, 27.3_

- [x] 17. Implement React UI — components
  - [x] 17.1 Create Chat components
    - Create `apps/ui/src/components/Chat/ChatWindow.tsx` — renders message history, input field, send button
    - Create `apps/ui/src/components/Chat/MessageBubble.tsx` — renders individual messages with markdown and syntax highlighting
    - Create `apps/ui/src/components/Chat/StreamingCursor.tsx` — displays streaming tokens progressively via `message:token` WebSocket events
    - Wire to chat.store for state management
    - _Requirements: 1.1, 1.3, 25.3_

  - [x] 17.2 Create File Explorer components
    - Create `apps/ui/src/components/FileExplorer/FileTree.tsx` — renders directory tree from `GET /api/filesystem/tree`
    - Create `apps/ui/src/components/FileExplorer/FilePreview.tsx` — displays file content fetched via `GET /api/files`
    - Display file name, type, size, and modification time for each entry
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 17.3 Create Terminal component
    - Create `apps/ui/src/components/Terminal/TerminalPane.tsx` using xterm.js
    - Connect to backend via WebSocket for terminal I/O
    - Send `terminal:input` events on user input
    - Render `terminal:output` events (stdout/stderr) in terminal emulator
    - Handle `terminal:exit` events to display exit code
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 17.4 Create Agent Panel components
    - Create `apps/ui/src/components/AgentPanel/AgentStatusList.tsx` — displays agent:status WebSocket events with agent name, status (idle/running/done/error), elapsed time
    - Create `apps/ui/src/components/AgentPanel/TaskProgress.tsx` — shows active tool calls and progress
    - Wire cancel button that sends `agent:cancel` WebSocket event
    - _Requirements: 7.5, 7.6, 7.7, 8.1, 8.2_

  - [x] 17.5 Create Confirmation Dialog
    - Create `apps/ui/src/components/ConfirmDialog/ConfirmDialog.tsx`
    - Modal triggered by `confirmation:request` WebSocket event
    - Display operation name, details, and full arguments
    - Approve button sends `confirmation:response` with approved=true
    - Deny button sends `confirmation:response` with approved=false
    - Block all other UI interactions until user responds
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.6_

  - [x] 17.6 Create Model Selector
    - Create `apps/ui/src/components/ModelSelector/ModelSelector.tsx`
    - Fetch available models via `GET /api/models`
    - Dropdown for model selection; send `PATCH /api/config/model` on change
    - Persist selection in session.store so it survives page reload
    - _Requirements: 20.1, 20.2, 20.3_

  - [x] 17.7 Create App layout and wire components
    - Create `apps/ui/src/App.tsx` with layout containing Chat, FileExplorer, Terminal, AgentPanel, ModelSelector panels
    - Mount ConfirmDialog as global overlay
    - Initialize WebSocket connection and session on app mount
    - Ensure no component imports directly from `apps/backend/`; all network calls go through http.client or ws.client
    - _Requirements: 25.1, 25.2, 25.3, 29.2_

  - [x] 17.8 Write unit tests for Confirmation Dialog
    - Test approval sends correct WebSocket event
    - Test denial sends correct WebSocket event
    - Test dialog blocks UI interaction
    - _Requirements: 19.3, 19.4, 19.6_

- [x] 18. Checkpoint - Verify React UI
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. Implement Tauri desktop shell
  - [x] 19.1 Configure Tauri
    - Configure `apps/ui/src-tauri/tauri.conf.json`:
      - Set `fs.scope` to restrict filesystem access to workspace path only
      - Set `allowlist.fs.all: false`
      - Configure window title ("Clover"), size, and min-size
    - Reject operations targeting paths outside workspace with permission error
    - _Requirements: 26.1, 26.4_

  - [x] 19.2 Create Tauri main process
    - Create `apps/ui/src-tauri/src/main.rs`
    - Spawn Node.js backend process on app start, passing workspace path as environment variable
    - Terminate Node.js backend process cleanly on window close
    - _Requirements: 26.2, 26.3_

  - [x] 19.3 Write unit tests for Tauri filesystem restrictions
    - Test that Tauri invoke rejects paths outside workspace
    - _Requirements: 26.1, 26.4_

- [x] 20. Implement scripts and distribution
  - [x] 20.1 Create startup and health scripts
    - Create `scripts/start-openclaude.sh` — checks OpenClaude installed, starts gRPC server on :50051, waits for ready, exits 1 if startup fails after 30s
    - Create `scripts/health-check.sh` — calls `GET /api/health`, prints status of each service, exits 0 if all healthy, exits 1 if any unhealthy
    - _Requirements: 21.1, 21.2, 30.1_

  - [x] 20.2 Create root package.json scripts
    - Add `dev` script (starts backend + openclaude + ui in parallel)
    - Add `build` script (pnpm build all packages)
    - Add `health` script (runs health-check.sh)
    - _Requirements: 30.1, 30.3_

- [x] 21. Integration wiring and end-to-end verification
  - [x] 21.1 Wire all backend modules together
    - Create `apps/backend/src/index.ts` entry point that:
      1. Loads config
      2. Initializes SQLite store
      3. Initializes LanceDB adapter
      4. Creates all services (memory, search, exec-guard, confirmation bus, tool registry, agent engine, orchestrator, planner)
      5. Starts gateway (HTTP + WebSocket)
      6. Starts vault watcher
      7. Registers graceful shutdown handlers
    - Verify dependency direction: gateway → orchestrator → agents → tools/memory/search (no circular imports)
    - _Requirements: 29.4, 30.1, 31.2_

  - [x] 21.2 Write integration tests for chat flow
    - Test: send message → orchestrator builds context → agent dispatched → tokens streamed via WebSocket → turn saved to SQLite → turn indexed to LanceDB
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 9.3, 10.3_

  - [x] 21.3 Write integration tests for file operations with confirmation
    - Test: write-overwrite triggers confirmation dialog → approval creates file → denial returns user_denied
    - Test: delete triggers confirmation → approval deletes → denial preserves file
    - _Requirements: 3.3, 4.1, 4.2, 4.3, 19.1_

  - [x] 21.4 Write integration tests for memory and vault
    - Test: modify vault file → watcher triggers re-index within 2s → subsequent search returns updated content
    - Test: reversa-ingest indexes .agents/skills/ and CLAUDE.md → search returns chunks with source="reversa"
    - _Requirements: 11.1, 11.3, 13.1, 13.2, 13.3_

  - [x] 21.5 Write integration tests for offline degradation
    - Test: when connectivity check returns false → search service uses offline adapter → no errors displayed
    - Test: all features except online search work normally when offline
    - _Requirements: 31.1, 31.2, 31.3_

- [x] 22. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at each major system boundary
- The implementation language is TypeScript throughout (React + Node.js + Tauri Rust for shell only)
- All backend services are embedded (LanceDB, SQLite) — no Docker required
- OpenClaude and Ollama are external processes assumed pre-installed by the user
