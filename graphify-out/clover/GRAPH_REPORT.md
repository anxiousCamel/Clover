# Graph Report - .  (2026-05-03)

## Corpus Check
- 117 files · ~73,772 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 401 nodes · 624 edges · 19 communities detected
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 29 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Helpers & Small Modules|Helpers & Small Modules]]
- [[_COMMUNITY_Module param.extractor.ts|Module: param.extractor.ts]]
- [[_COMMUNITY_WebSocket Communication|WebSocket Communication]]
- [[_COMMUNITY_Module memory.service.ts|Module: memory.service.ts]]
- [[_COMMUNITY_Module ws.server.ts|Module: ws.server.ts]]
- [[_COMMUNITY_Storage & Persistence|Storage & Persistence]]
- [[_COMMUNITY_Module agent-engine.ts|Module: agent-engine.ts]]
- [[_COMMUNITY_Module ollama.client.ts|Module: ollama.client.ts]]
- [[_COMMUNITY_Module http.client.ts|Module: http.client.ts]]
- [[_COMMUNITY_Module openclaude.client.ts|Module: openclaude.client.ts]]
- [[_COMMUNITY_Module session.manager.ts|Module: session.manager.ts]]
- [[_COMMUNITY_Module planner.service.ts|Module: planner.service.ts]]
- [[_COMMUNITY_Module heuristic.gate.ts|Module: heuristic.gate.ts]]
- [[_COMMUNITY_Module exec-guard.ts|Module: exec-guard.ts]]
- [[_COMMUNITY_Module search.service.ts|Module: search.service.ts]]
- [[_COMMUNITY_Module edit-file.tool.ts|Module: edit-file.tool.ts]]
- [[_COMMUNITY_Module main.rs|Module: main.rs]]
- [[_COMMUNITY_Module IntentClassifier|Module: IntentClassifier]]
- [[_COMMUNITY_Module list-files.tool.ts|Module: list-files.tool.ts]]

## God Nodes (most connected - your core abstractions)
1. `SQLiteStore` - 21 edges
2. `dispatch()` - 10 edges
3. `evaluateGate()` - 10 edges
4. `runPipeline()` - 10 edges
5. `classifyIntent()` - 10 edges
6. `resolveFilePath()` - 10 edges
7. `pipelineLog()` - 10 edges
8. `registerRoutes()` - 9 edges
9. `updateContext()` - 8 edges
10. `extractParams()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `syncContext()` --calls--> `updateContext()`  [INFERRED]
  apps\backend\src\agents\agent-engine.ts → apps\backend\src\pipeline\context.store.ts
- `dispatch()` --calls--> `runPipeline()`  [INFERRED]
  apps\backend\src\agents\agent-engine.ts → apps\backend\src\pipeline\index.ts
- `dispatch()` --calls--> `updateContext()`  [INFERRED]
  apps\backend\src\agents\agent-engine.ts → apps\backend\src\pipeline\context.store.ts
- `start()` --calls--> `resolve()`  [INFERRED]
  apps\backend\src\memory\vault.watcher.ts → apps\backend\src\confirmation\confirmation.bus.ts
- `push()` --calls--> `resolve()`  [INFERRED]
  apps\backend\src\openclaude\openclaude.client.ts → apps\backend\src\confirmation\confirmation.bus.ts

## Communities

### Community 999 - "Helpers & Small Modules"
Cohesion: 0.02
Nodes (7): WorkspaceBoundaryError, WorkspaceBoundaryError, WorkspaceBoundaryError, Clover, Multi-Agent Architecture, Tool System, Context Compression

### Community 0 - "Module: param.extractor.ts"
Cohesion: 0.11
Nodes (33): getContext(), setLastFilePath(), setLastGeneratedContent(), setLastIntent(), updateContext(), buildToolArgs(), routeExecution(), validateBeforeExecution() (+25 more)

### Community 1 - "WebSocket Communication"
Cohesion: 0.08
Nodes (14): AgentStatusList(), useElapsedTimers(), connect(), emit(), onEvent(), openSocket(), formatTimestamp(), getBubbleStyle() (+6 more)

### Community 2 - "Module: memory.service.ts"
Cohesion: 0.09
Nodes (22): applyEnvOverrides(), coerce(), toEnvKey(), ConfirmationTimeoutError, resolve(), snapToSentenceBoundary(), split(), indexFile() (+14 more)

### Community 3 - "Module: ws.server.ts"
Cohesion: 0.09
Nodes (10): registerRoutes(), start(), stop(), emit(), onEvent(), register(), requestConfirmation(), wireConfirmationHandlers() (+2 more)

### Community 4 - "Storage & Persistence"
Cohesion: 0.1
Nodes (8): initPipelineLogger(), boot(), chat(), findWorkspaceRoot(), main(), renderBanner(), rowToObject(), SQLiteStore

### Community 5 - "Module: agent-engine.ts"
Cohesion: 0.09
Nodes (17): dispatch(), emitStatus(), executePipelineTool(), extractUserMessage(), handleToolCall(), injectSystemPrompt(), loadAgents(), matchIntent() (+9 more)

### Community 6 - "Module: ollama.client.ts"
Cohesion: 0.12
Nodes (10): embed(), insert(), similaritySearch(), upsertByPath(), chat(), embed(), fetchWithRetry(), listModels() (+2 more)

### Community 7 - "Module: http.client.ts"
Cohesion: 0.15
Nodes (6): del(), get(), HttpError, patch(), post(), request()

### Community 8 - "Module: openclaude.client.ts"
Cohesion: 0.22
Nodes (10): complete(), createClient(), ensureProto(), getAddress(), getClient(), reconnect(), toProtoRequest(), tryReconnectOnState() (+2 more)

### Community 9 - "Module: session.manager.ts"
Cohesion: 0.18
Nodes (6): compressHistory(), buildContextWindow(), formatMemoryChunks(), getModel(), getSession(), loadHistory()

### Community 10 - "Module: planner.service.ts"
Cohesion: 0.35
Nodes (7): emitProgress(), generate(), loadReversaContext(), scanFileTree(), buildDesignPrompt(), buildRequirementsPrompt(), buildTasksPrompt()

### Community 11 - "Module: heuristic.gate.ts"
Cohesion: 0.47
Nodes (9): evaluateGate(), scoreActionVerb(), scoreContentRequest(), scoreDeictic(), scoreFilePath(), scoreFilesystemNoun(), scoreImperative(), scoreInterrogative() (+1 more)

### Community 12 - "Module: exec-guard.ts"
Cohesion: 0.31
Nodes (4): isDenied(), DeniedCommandError, run(), TimeoutError

### Community 13 - "Module: search.service.ts"
Cohesion: 0.28
Nodes (2): isOnline(), search()

### Community 14 - "Module: edit-file.tool.ts"
Cohesion: 0.25
Nodes (4): AmbiguousMatchError, applyStringReplacement(), countOccurrences(), WorkspaceBoundaryError

### Community 15 - "Module: main.rs"
Cohesion: 0.32
Nodes (5): BackendProcess, main(), spawn_backend(), terminate_backend(), WorkspaceState

### Community 16 - "Module: IntentClassifier"
Cohesion: 0.33
Nodes (6): ExecutionRouter, HeuristicGate, IntentClassifier, Ollama, OS Abstraction, ParamExtractor

### Community 17 - "Module: list-files.tool.ts"
Cohesion: 0.4
Nodes (1): WorkspaceBoundaryError

## Knowledge Gaps
- **8 isolated node(s):** `WorkspaceState`, `BackendProcess`, `Multi-Agent Architecture`, `Tool System`, `HeuristicGate` (+3 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Module: search.service.ts`** (9 nodes): `connectivity.check.ts`, `duckduckgo.adapter.ts`, `search.service.ts`, `search-online.tool.ts`, `formatResults()`, `isOnline()`, `parseResults()`, `registerAdapter()`, `search()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module: list-files.tool.ts`** (5 nodes): `list-files.tool.ts`, `listEntries()`, `resolveAndValidate()`, `WorkspaceBoundaryError`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.