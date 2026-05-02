# Requirements — Clover Local AI Assistant

## Context

Desktop AI assistant (local-first, no cloud dependency) inspired by Claude Code.
Single-user. Windows/macOS/Linux via Tauri. No Docker.

Stack: React + Tauri (UI) · Node.js (backend/orchestrator) · OpenClaude gRPC (AI core) · Ollama (inference + embeddings) · LanceDB embedded (vector memory) · Obsidian vault (knowledge base) · SQLite (sessions) · DuckDuckGo (online search, swappable)

---

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR01 | User sends a message in chat UI; system returns streamed AI response within 500ms of first token |
| FR02 | User can open any file within the active workspace through a file explorer panel |
| FR03 | System reads file contents and provides them as context to AI when requested |
| FR04 | System writes or patches files within the workspace on AI instruction |
| FR05 | System deletes files within the workspace only after explicit user confirmation in UI |
| FR06 | User can execute shell commands through an integrated terminal panel |
| FR07 | All shell commands run in subprocess with cwd=workspace, 30s timeout, and stdout/stderr streamed to terminal panel |
| FR08 | System selects an appropriate agent (Planner, Coder, Reviewer, Executor, Researcher, Memory) based on user intent |
| FR09 | Each agent has a defined system prompt, tool allowlist, and intent-matching rule |
| FR10 | Conversation history persists per session in SQLite and is included in context window |
| FR11 | System retrieves semantically relevant chunks from LanceDB and prepends to every AI prompt |
| FR12 | Every completed conversation turn is chunked, embedded via Ollama, and stored in LanceDB |
| FR13 | Obsidian vault files are watched via fs.watch; any change triggers incremental re-indexing into LanceDB |
| FR14 | AI can create new notes in the vault; existing notes are never silently overwritten |
| FR15 | AI can append to existing vault notes; overwrite requires explicit user confirmation |
| FR16 | User can trigger Reversa skill file ingestion (`.agents/skills/`, `CLAUDE.md`) into LanceDB from UI |
| FR17 | Ingested Reversa context is tagged `source:"reversa"` and surfaced in RAG retrieval |
| FR18 | System performs online search via DuckDuckGo when internet is available |
| FR19 | System falls back to LanceDB offline semantic search over indexed knowledge base when offline |
| FR20 | Online/offline selection is automatic based on connectivity check before each search |
| FR21 | Search provider is swappable via adapter pattern without changes to caller code |
| FR22 | User can trigger planner to generate `requirements.md`, `design.md`, `tasks.md` in workspace |
| FR23 | Planner produces each file in a strict parseable format (defined in design.md section 7) |
| FR24 | `tasks.md` checkboxes are patched (not rewritten) as tasks complete |
| FR25 | Any tool call classified as destructive (write-overwrite, delete, execute-command) requires UI confirmation before execution |
| FR26 | User can approve or deny a confirmation request; denial returns `user_denied` to AI as tool result |
| FR27 | Agent status (idle/running/done/error) is visible in UI in real time via WebSocket events |
| FR28 | User can cancel an in-progress agent run |
| FR29 | User can select active Ollama model from UI; selection persists in config |
| FR30 | System exposes health check endpoint reporting status of OpenClaude, Ollama, LanceDB, SQLite |

---

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF01 | No Docker dependency — all components run as native processes or embedded libraries |
| NF02 | No cloud dependency for AI core — all inference runs on local Ollama |
| NF03 | Cross-platform desktop distribution via Tauri (Windows, macOS, Linux) |
| NF04 | First token latency under 500ms for simple completions on local hardware |
| NF05 | UI never communicates with OpenClaude directly — all calls go through Node.js backend |
| NF06 | Filesystem access restricted to workspace path by default; outside requires explicit confirmation |
| NF07 | New tools added by dropping a `*.tool.ts` file in `plugins/` — no changes to existing code |
| NF08 | New Ollama models added via `models.config.json` — no code changes |
| NF09 | New search adapters added by implementing `SearchAdapter` interface + one-line registration |
| NF10 | New agents added by implementing `Agent` interface + one-line registration in agent-engine |
| NF11 | System degrades gracefully offline: search uses offline adapter, all other features unaffected |
| NF12 | Obsidian vault write safety: backup created before any overwrite; append-only preferred |
| NF13 | Subprocess exec-guard maintains deny-list of destructive patterns (rm -rf /, format, mkfs, dd if=) |
| NF14 | Confirmation bus times out after 60s if user does not respond; operation is denied |
| NF15 | Shared types in `shared/types/` — UI and backend must not duplicate type definitions |
| NF16 | No circular dependencies: gateway → orchestrator → agents → tools/memory/search (one direction only) |

---

## Constraints

- Reversa integration is **read-only ingestion only** (Option B) — no subprocess invocation of Reversa CLI as core flow
- Project Nomad is **not used** — replaced by LanceDB offline search (avoids Docker)
- OpenClaude runs as separate gRPC process on port 50051 — backend does not embed it
- Ollama runs as separate process on port 11434 — assumed pre-installed by user
- LanceDB is embedded in the Node.js backend process — no separate server
- SQLite is embedded in the Node.js backend process — no separate server
- Tauri `tauri.conf.json` must restrict filesystem allowlist to workspace path

---

## Out of Scope (v1)

- Multi-user or networked deployment
- Authentication / authorization between UI and backend
- Cloud model providers (OpenAI, Anthropic API, etc.)
- Mobile or web-only interface
- Plugin marketplace or remote tool distribution
- Collaborative editing of vault notes
- Git integration beyond what tools can invoke via execute-command
