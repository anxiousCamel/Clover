# Requirements Document

## Introduction

Clover é um assistente de IA desktop local-first, sem dependência de cloud, inspirado no Claude Code. O sistema é single-user, cross-platform (Windows/macOS/Linux) via Tauri, sem Docker. A stack inclui React + Tauri (UI), Node.js (backend/orchestrator), OpenClaude gRPC (AI core), Ollama (inferência + embeddings), LanceDB embedded (memória vetorial), Obsidian vault (base de conhecimento), SQLite (sessões) e DuckDuckGo (busca online, substituível via adapter pattern).

## Glossary

- **Clover**: O sistema assistente de IA desktop local-first sendo especificado neste documento
- **Chat_UI**: Interface de chat do usuário no painel React, responsável por enviar mensagens e exibir respostas streamed
- **File_Explorer**: Painel de exploração de arquivos na UI que permite navegar e abrir arquivos do workspace
- **Terminal_Panel**: Painel de terminal integrado na UI baseado em xterm.js para execução de comandos shell
- **Agent_Engine**: Motor de seleção e despacho de agentes que roteia mensagens para o agente apropriado com base na intenção do usuário
- **Agent**: Entidade especializada com system prompt, lista de ferramentas permitidas e regra de correspondência de intenção (Planner, Coder, Reviewer, Executor, Researcher, Memory)
- **Tool_Registry**: Registro central de ferramentas que auto-descobre plugins, valida argumentos com Zod e verifica necessidade de confirmação
- **Tool_Plugin**: Plugin de ferramenta que implementa a interface ToolPlugin (name, description, inputSchema, requiresConfirmation, execute)
- **Memory_Service**: Serviço de memória que coordena chunking, embedding, armazenamento vetorial e acesso ao vault Obsidian
- **LanceDB_Adapter**: Adaptador para o banco vetorial LanceDB embedded, responsável por insert, upsert e similarity search
- **Obsidian_Adapter**: Adaptador para leitura/escrita de arquivos markdown no vault Obsidian com regras de segurança de escrita
- **Embedder**: Componente que converte texto em vetores float[] via Ollama embeddings API
- **Chunker**: Componente que divide texto em chunks de 512 tokens com 50 tokens de overlap usando tiktoken
- **Vault_Watcher**: Observador de mudanças no vault Obsidian via fs.watch com debounce de 500ms
- **Search_Service**: Serviço unificado de busca que seleciona automaticamente entre adaptador online e offline
- **Search_Adapter**: Interface para provedores de busca (DuckDuckGo online, LanceDB offline)
- **DuckDuckGo_Adapter**: Adaptador de busca online que implementa SearchAdapter usando DuckDuckGo
- **Offline_Adapter**: Adaptador de busca offline que implementa SearchAdapter usando LanceDB
- **Connectivity_Check**: Componente que verifica conectividade com a internet via HEAD request com timeout de 2s
- **Exec_Guard**: Guarda de execução de comandos que aplica deny-list, restringe cwd ao workspace e impõe timeout
- **Deny_List**: Lista de padrões regex de comandos bloqueados (rm -rf /, format, mkfs, dd if=, fork bomb)
- **Confirmation_Bus**: Barramento de confirmação que emite requests via WebSocket e aguarda resposta do usuário com timeout de 60s
- **Planner_Service**: Serviço de planejamento que gera documentos requirements.md, design.md e tasks.md em formato estruturado
- **Orchestrator**: Componente central que constrói contexto de sessão, busca memória, despacha para Agent_Engine e persiste turnos
- **Session_Manager**: Gerenciador de sessões que carrega/salva histórico de conversação do SQLite e constrói a janela de contexto
- **Gateway**: Servidor Fastify HTTP + WebSocket que roteia requisições para o Orchestrator e emite eventos WS
- **OpenClaude_Client**: Cliente gRPC para o serviço OpenClaude na porta 50051 com suporte a streaming e reconexão
- **Ollama_Client**: Cliente HTTP para Ollama na porta 11434 com retry (3 tentativas, 1s backoff) para chat, embeddings e listagem de modelos
- **SQLite_Store**: Armazenamento SQLite embedded para sessões, histórico de mensagens e log de execução de ferramentas
- **Tauri_Shell**: Shell desktop nativo Tauri que gerencia janela, restrição de filesystem e ciclo de vida do processo backend
- **Workspace**: Diretório raiz do projeto do usuário, usado como sandbox para todas as operações de arquivo e execução de comandos
- **RAG**: Retrieval-Augmented Generation — técnica de recuperar chunks relevantes da memória vetorial para enriquecer o prompt da IA
- **Confirmation_Dialog**: Modal na UI que exibe detalhes de operações destrutivas e permite ao usuário aprovar ou negar

## Requirements

### Requirement 1: Chat com Respostas Streamed

**User Story:** As a user, I want to send messages in a chat interface and receive streamed AI responses, so that I can interact with the AI assistant in real time.

#### Acceptance Criteria

1. WHEN the user sends a message in the Chat_UI, THE Gateway SHALL accept the message and return HTTP 202 within 100ms
2. WHEN the Gateway receives a chat message, THE Orchestrator SHALL build a CompletionRequest containing system prompt, memory chunks, conversation history, and the user message in that order
3. WHILE the OpenClaude_Client is streaming a completion, THE Gateway SHALL emit `message:token` WebSocket events to the Chat_UI for each token received
4. WHEN the OpenClaude_Client stream completes, THE Gateway SHALL emit a `message:done` WebSocket event containing sessionId and usage statistics
5. IF the OpenClaude_Client stream fails, THEN THE Gateway SHALL emit a `message:error` WebSocket event containing the error description

### Requirement 2: Explorador de Arquivos

**User Story:** As a user, I want to browse and open files within my workspace through a file explorer panel, so that I can navigate my project structure visually.

#### Acceptance Criteria

1. THE File_Explorer SHALL display the directory tree of the active Workspace via `GET /api/filesystem/tree`
2. WHEN the user clicks a file in the File_Explorer, THE Chat_UI SHALL fetch and display the file content via `GET /api/files`
3. THE File_Explorer SHALL display file name, type, size, and modification time for each entry
4. WHEN the user requests a directory listing with a depth parameter, THE Gateway SHALL return entries up to the specified depth level (default depth: 1)

### Requirement 3: Leitura e Escrita de Arquivos pela IA

**User Story:** As a user, I want the AI to read, write, and patch files within my workspace, so that the AI can assist me with code implementation.

#### Acceptance Criteria

1. WHEN the AI requests to read a file, THE Tool_Registry SHALL execute the read-file plugin and return the file content to the AI
2. WHEN the AI requests to write a new file, THE Tool_Registry SHALL create the file within the Workspace without requiring confirmation
3. WHEN the AI requests to overwrite an existing file, THE Confirmation_Bus SHALL request user approval before proceeding
4. WHEN the AI requests to patch a file, THE Tool_Registry SHALL apply the edit using string replacement or line-range replacement without rewriting the full file
5. IF a patch pattern matches multiple locations in the file, THEN THE edit-file plugin SHALL return an AmbiguousMatchError without modifying the file
6. IF a file read or write targets a path outside the Workspace, THEN THE Tool_Registry SHALL reject the operation with a WorkspaceBoundaryError

### Requirement 4: Exclusão de Arquivos com Confirmação

**User Story:** As a user, I want file deletions to require my explicit approval, so that I am protected from accidental data loss.

#### Acceptance Criteria

1. WHEN the AI requests to delete a file, THE Confirmation_Bus SHALL emit a `confirmation:request` WebSocket event to the Chat_UI before executing
2. WHEN the user approves the deletion, THE Tool_Registry SHALL delete the file and return the result to the AI
3. WHEN the user denies the deletion, THE Tool_Registry SHALL return `user_denied` as the tool result to the AI without deleting the file

### Requirement 5: Terminal Integrado

**User Story:** As a user, I want an integrated terminal panel to execute shell commands, so that I can run builds, tests, and other commands without leaving the application.

#### Acceptance Criteria

1. THE Terminal_Panel SHALL render a terminal emulator using xterm.js connected to the backend via WebSocket
2. WHEN the user types a command in the Terminal_Panel, THE Chat_UI SHALL send a `terminal:input` WebSocket event to the Gateway
3. WHILE a command is executing, THE Gateway SHALL stream `terminal:output` WebSocket events containing stdout and stderr chunks to the Terminal_Panel
4. WHEN a command finishes, THE Gateway SHALL emit a `terminal:exit` WebSocket event containing the exit code

### Requirement 6: Execução de Comandos pela IA com Proteção

**User Story:** As a user, I want the AI to execute shell commands on my behalf with safety protections, so that I can automate tasks without risking destructive operations.

#### Acceptance Criteria

1. WHEN the AI requests to execute a command, THE Confirmation_Bus SHALL request user approval before execution
2. WHEN the user approves command execution, THE Exec_Guard SHALL spawn the command as a subprocess with cwd restricted to the Workspace
3. THE Exec_Guard SHALL enforce a configurable timeout (default 30s) on all spawned subprocesses
4. WHEN a command matches a pattern in the Deny_List, THE Exec_Guard SHALL reject the command with a DeniedCommandError without spawning a subprocess
5. THE Deny_List SHALL block patterns including `rm -rf /`, `format`, `mkfs`, `dd if=`, and fork bomb variants
6. THE Deny_List SHALL permit common development commands such as `rm ./file.txt`, `npm run build`, and `git status`
7. WHILE a command is executing via the AI, THE Exec_Guard SHALL stream stdout and stderr chunks via `terminal:output` WebSocket events

### Requirement 7: Sistema Multi-Agente com Roteamento por Intenção

**User Story:** As a user, I want the system to automatically route my messages to the most appropriate specialized agent, so that I receive expert assistance for each type of task.

#### Acceptance Criteria

1. THE Agent_Engine SHALL support six agent types: Planner, Coder, Reviewer, Executor, Researcher, and Memory
2. WHEN a user message is received, THE Agent_Engine SHALL evaluate each Agent's matchesIntent function in priority order and dispatch to the first matching Agent
3. THE Agent_Engine SHALL restrict each Agent to use only the tools defined in its allowedTools list
4. IF an Agent attempts to use a tool not in its allowedTools list, THEN THE Agent_Engine SHALL reject the tool call before execution
5. WHEN an Agent is dispatched, THE Gateway SHALL emit an `agent:status` WebSocket event with status "running"
6. WHEN an Agent completes its task, THE Gateway SHALL emit an `agent:status` WebSocket event with status "done"
7. IF an Agent encounters an error, THEN THE Gateway SHALL emit an `agent:status` WebSocket event with status "error" and error detail

### Requirement 8: Cancelamento de Execução de Agente

**User Story:** As a user, I want to cancel an in-progress agent run, so that I can stop long-running or unwanted operations.

#### Acceptance Criteria

1. WHEN the user sends an `agent:cancel` WebSocket event, THE Agent_Engine SHALL terminate the active gRPC stream for the specified session
2. WHEN the Agent_Engine cancels an agent run, THE Gateway SHALL emit an `agent:status` WebSocket event with status "done" and a cancellation indicator

### Requirement 9: Persistência de Sessão e Histórico

**User Story:** As a user, I want my conversation history to persist across sessions, so that I can continue previous conversations.

#### Acceptance Criteria

1. WHEN a new session is created via `POST /api/sessions`, THE Session_Manager SHALL create a session record in the SQLite_Store with the workspace path
2. WHEN the Orchestrator handles a message, THE Session_Manager SHALL load the last N messages (default 20) from the SQLite_Store for the active session
3. WHEN a conversation turn completes, THE Orchestrator SHALL save the user message and AI response to the SQLite_Store
4. THE Session_Manager SHALL build the context window in the order: system prompt, memory chunks, conversation history, user message
5. WHEN a session is deleted via `DELETE /api/sessions/:id`, THE Session_Manager SHALL remove the session and its history from the SQLite_Store

### Requirement 10: Memória RAG com LanceDB

**User Story:** As a user, I want the AI to remember relevant context from past conversations and my knowledge base, so that responses are informed by accumulated knowledge.

#### Acceptance Criteria

1. WHEN the Orchestrator handles a message, THE Memory_Service SHALL perform a similarity search in LanceDB with the user message and return the top-K most relevant chunks (default K=5)
2. THE Orchestrator SHALL prepend the retrieved memory chunks as a "Context" block in the system prompt before the conversation history
3. WHEN a conversation turn completes, THE Memory_Service SHALL chunk the turn text, embed each chunk via the Embedder, and insert the vectors into LanceDB
4. THE Chunker SHALL split text into chunks of 512 tokens with 50 tokens of overlap, preserving sentence boundaries where possible
5. THE Embedder SHALL convert text to float vectors by calling the Ollama embeddings API with the configured embed model

### Requirement 11: Indexação e Observação do Vault Obsidian

**User Story:** As a user, I want changes to my Obsidian vault to be automatically indexed, so that the AI always has access to my latest notes.

#### Acceptance Criteria

1. WHEN the Vault_Watcher detects a file change in the configured vault path, THE Memory_Service SHALL re-index the changed file within 2 seconds
2. THE Vault_Watcher SHALL debounce file change events with a 500ms window to avoid redundant re-indexing
3. WHEN re-indexing a file, THE LanceDB_Adapter SHALL remove old chunks for the same file path before inserting new chunks (upsert behavior)
4. WHEN the Memory_Service indexes a file, THE Gateway SHALL emit a `memory:indexed` WebSocket event with source, chunk count, and file path

### Requirement 12: Escrita Segura no Vault Obsidian

**User Story:** As a user, I want vault write operations to follow strict safety rules, so that my notes are never accidentally overwritten or lost.

#### Acceptance Criteria

1. WHEN the AI writes a note with mode "create-only", THE Obsidian_Adapter SHALL create the file only if it does not exist
2. IF the AI writes a note with mode "create-only" and the file already exists, THEN THE Obsidian_Adapter SHALL return an error without modifying the file
3. WHEN the AI writes a note with mode "append", THE Obsidian_Adapter SHALL append the content to the existing file with a separator
4. WHEN the AI writes a note with mode "overwrite", THE Confirmation_Bus SHALL request user approval before proceeding
5. WHEN the user approves an overwrite, THE Obsidian_Adapter SHALL create a .bak backup copy of the existing file before writing the new content
6. THE memory-write plugin SHALL require confirmation only for mode "overwrite" and SHALL proceed without confirmation for modes "append" and "create-only"

### Requirement 13: Ingestão de Contexto Reversa

**User Story:** As a user, I want to ingest Reversa skill files and CLAUDE.md into the AI's memory, so that the AI can leverage existing project-specific knowledge.

#### Acceptance Criteria

1. WHEN the user triggers the reversa-ingest tool, THE Memory_Service SHALL ingest all files in the `.agents/skills/` directory
2. WHEN the user triggers the reversa-ingest tool and a `CLAUDE.md` file exists in the Workspace, THE Memory_Service SHALL index that file
3. THE Memory_Service SHALL tag all chunks from Reversa ingestion with `source:"reversa"`
4. WHEN a RAG search is performed, THE Memory_Service SHALL include Reversa-sourced chunks in the search results alongside other sources

### Requirement 14: Busca Online com DuckDuckGo

**User Story:** As a user, I want the AI to search the internet for current information when I'm online, so that responses include up-to-date knowledge.

#### Acceptance Criteria

1. WHEN the AI triggers a search and the Connectivity_Check returns true, THE Search_Service SHALL use the DuckDuckGo_Adapter to perform the search
2. THE DuckDuckGo_Adapter SHALL return search results containing title, URL, and snippet for each result
3. THE Connectivity_Check SHALL determine online status by sending a HEAD request to a reliable endpoint with a 2-second timeout

### Requirement 15: Busca Offline com Fallback Automático

**User Story:** As a user, I want the AI to fall back to local semantic search when I'm offline, so that search functionality remains available without internet.

#### Acceptance Criteria

1. WHEN the AI triggers a search and the Connectivity_Check returns false, THE Search_Service SHALL use the Offline_Adapter to perform a semantic search in LanceDB
2. THE Search_Service SHALL check adapter availability via isAvailable() before each search and select the highest-priority available adapter
3. THE Offline_Adapter SHALL always report isAvailable() as true since it uses the embedded LanceDB instance

### Requirement 16: Adapter Pattern para Provedores de Busca

**User Story:** As a developer, I want search providers to be swappable via an adapter pattern, so that I can add new search providers without modifying existing code.

#### Acceptance Criteria

1. THE Search_Service SHALL select search adapters from an ordered priority list, using the first adapter where isAvailable() returns true
2. THE Search_Adapter interface SHALL define: name (string), isAvailable() (Promise<boolean>), and search(query, options) (Promise<SearchResult[]>)
3. WHEN a new Search_Adapter implementation is registered in the Search_Service, THE Search_Service SHALL include it in adapter selection without changes to caller code

### Requirement 17: Serviço de Planejamento (Planner)

**User Story:** As a user, I want to generate structured planning documents from a goal description, so that I can quickly scaffold project requirements, design, and tasks.

#### Acceptance Criteria

1. WHEN the user triggers planning via `POST /api/planner/generate`, THE Planner_Service SHALL generate three files: requirements.md, design.md, and tasks.md in the specified Workspace
2. THE Planner_Service SHALL generate each file using a dedicated prompt template that enforces the expected output format
3. THE Planner_Service SHALL write each planning file using the Obsidian_Adapter with mode "create-only" to prevent silent overwrites
4. WHILE the Planner_Service is generating files, THE Gateway SHALL emit `planner:progress` WebSocket events indicating the current phase
5. WHEN the Planner_Service completes all files, THE Gateway SHALL emit a `planner:done` WebSocket event with the list of generated file paths
6. THE tasks.md template SHALL enforce the task format: `TASK-NNN | agent | depends:X | description | done when: criterion`

### Requirement 18: Atualização de Tasks por Patch

**User Story:** As a user, I want task checkboxes to be updated incrementally, so that the tasks.md file is never fully rewritten and preserves manual edits.

#### Acceptance Criteria

1. WHEN a task is marked as complete, THE edit-file plugin SHALL patch only the specific checkbox line in tasks.md using string replacement
2. THE edit-file plugin SHALL preserve all other content in tasks.md unchanged during a patch operation

### Requirement 19: Confirmação de Operações Destrutivas

**User Story:** As a user, I want all destructive operations to require my explicit approval, so that I maintain control over potentially harmful actions.

#### Acceptance Criteria

1. WHEN a tool call is classified as destructive (write-overwrite, delete, execute-command), THE Confirmation_Bus SHALL emit a `confirmation:request` WebSocket event before execution
2. THE Confirmation_Dialog SHALL display the operation name, details, and full arguments to the user
3. WHEN the user clicks "Approve", THE Confirmation_Dialog SHALL send a `confirmation:response` WebSocket event with approved=true
4. WHEN the user clicks "Deny", THE Confirmation_Dialog SHALL send a `confirmation:response` WebSocket event with approved=false
5. IF the user does not respond within 60 seconds, THEN THE Confirmation_Bus SHALL reject the operation as denied with a TimeoutError
6. THE Confirmation_Dialog SHALL block all other UI interactions until the user responds

### Requirement 20: Seleção de Modelo Ollama

**User Story:** As a user, I want to select which Ollama model to use from the UI, so that I can switch between models based on my needs.

#### Acceptance Criteria

1. THE ModelSelector SHALL fetch the list of available models via `GET /api/models` from the Ollama_Client
2. WHEN the user selects a model in the ModelSelector, THE Chat_UI SHALL send a `PATCH /api/config/model` request to update the active model
3. THE Session_Manager SHALL persist the selected model in the session store so that the selection survives page reload

### Requirement 21: Health Check do Sistema

**User Story:** As a user, I want to check the health status of all system components, so that I can diagnose connectivity or configuration issues.

#### Acceptance Criteria

1. WHEN a `GET /api/health` request is received, THE Gateway SHALL return the status of OpenClaude, Ollama, LanceDB, and SQLite
2. THE Gateway SHALL report each component as "healthy" or "unhealthy" with a descriptive status message

### Requirement 22: Auto-Descoberta de Tool Plugins

**User Story:** As a developer, I want new tools to be automatically discovered by dropping a file in the plugins directory, so that extending the system requires no code changes to existing modules.

#### Acceptance Criteria

1. WHEN the Tool_Registry loads plugins, THE Tool_Registry SHALL auto-discover all `*.tool.ts` files in the plugins directory via glob pattern
2. WHEN a new `*.tool.ts` file is added to the plugins directory, THE Tool_Registry SHALL include it in the available tools without changes to existing code
3. THE Tool_Registry SHALL validate tool arguments using the Zod schema defined in each Tool_Plugin before execution
4. IF Zod validation fails, THEN THE Tool_Registry SHALL return a typed validation error to the caller without executing the tool

### Requirement 23: Validação de Argumentos de Ferramentas

**User Story:** As a developer, I want all tool arguments to be validated before execution, so that invalid inputs are caught early and produce clear error messages.

#### Acceptance Criteria

1. WHEN the Tool_Registry receives a tool call, THE Tool_Registry SHALL validate the arguments against the tool's Zod inputSchema before calling execute
2. IF validation fails, THEN THE Tool_Registry SHALL return a typed error containing the validation details without executing the tool
3. THE Tool_Registry SHALL check the tool's requiresConfirmation function with the validated arguments before execution

### Requirement 24: Gateway HTTP e WebSocket

**User Story:** As a developer, I want a unified HTTP and WebSocket gateway, so that the UI communicates with the backend through a single well-defined interface.

#### Acceptance Criteria

1. THE Gateway SHALL run a Fastify HTTP server on the configured port (default 3001) with CORS restricted to localhost
2. THE Gateway SHALL provide WebSocket support via `@fastify/websocket` with connections managed by sessionId
3. THE Gateway SHALL validate all HTTP request bodies using Fastify schema validation
4. THE Gateway SHALL return all errors in the format `{ error: string, code: string }`

### Requirement 25: Comunicação UI via Camada de API

**User Story:** As a developer, I want all UI network calls to go through a typed API layer, so that components never make direct backend calls.

#### Acceptance Criteria

1. THE Chat_UI SHALL make all HTTP calls through the http.client module with typed request and response interfaces
2. THE Chat_UI SHALL make all WebSocket communications through the ws.client module with typed event handlers
3. THE Chat_UI SHALL manage all application state through Zustand stores (chat.store, agent.store, session.store) without direct backend imports
4. IF the http.client receives a non-2xx response, THEN THE http.client SHALL throw a typed HttpError containing the status code and error message

### Requirement 26: Tauri Desktop Shell com Sandbox de Filesystem

**User Story:** As a user, I want the desktop application to restrict filesystem access to my workspace, so that the AI cannot access files outside my project.

#### Acceptance Criteria

1. THE Tauri_Shell SHALL configure `fs.scope` in tauri.conf.json to restrict filesystem access to the Workspace path only
2. WHEN the Tauri_Shell starts, THE Tauri_Shell SHALL spawn the Node.js backend process and pass the Workspace path as an environment variable
3. WHEN the Tauri_Shell window is closed, THE Tauri_Shell SHALL terminate the Node.js backend process cleanly
4. IF a Tauri filesystem invoke targets a path outside the Workspace, THEN THE Tauri_Shell SHALL reject the operation with a permission error

### Requirement 27: Reconexão e Resiliência de Clientes

**User Story:** As a user, I want the system to handle connection failures gracefully, so that temporary disconnections don't require restarting the application.

#### Acceptance Criteria

1. WHEN the OpenClaude gRPC connection is lost, THE OpenClaude_Client SHALL attempt automatic reconnection
2. WHEN the WebSocket connection is lost, THE ws.client SHALL attempt reconnection with exponential backoff
3. THE ws.client SHALL preserve registered event handlers across reconnections
4. THE Ollama_Client SHALL retry failed requests up to 3 times with 1-second backoff between attempts

### Requirement 28: Extensibilidade de Agentes e Modelos

**User Story:** As a developer, I want to add new agents and models with minimal code changes, so that the system is easy to extend.

#### Acceptance Criteria

1. WHEN a new Agent implementation file is added to the agents directory, THE Agent_Engine SHALL include it in intent routing after a one-line registration in agent-engine.ts
2. WHEN a new model entry is added to `models.config.json` with `capabilities:["chat"]` or `capabilities:["embed"]`, THE Ollama_Client SHALL make it available without code changes
3. THE Agent interface SHALL require: name, systemPrompt, allowedTools (string[]), matchesIntent (function), and maxTurns

### Requirement 29: Regras de Dependência entre Módulos

**User Story:** As a developer, I want strict one-way dependency rules between modules, so that the codebase remains maintainable and free of circular dependencies.

#### Acceptance Criteria

1. THE shared/ package SHALL have no imports from apps/ui/ or apps/backend/
2. THE apps/ui/ package SHALL import only from shared/types/ and SHALL have no imports from apps/backend/
3. THE apps/backend/ package SHALL import only from shared/ and SHALL have no imports from apps/ui/
4. WITHIN apps/backend/, THE dependency direction SHALL follow: gateway → orchestrator → agents → tools/memory/search, with no module importing its caller

### Requirement 30: Operação Sem Docker e Sem Cloud

**User Story:** As a user, I want the entire system to run locally without Docker or cloud dependencies, so that I have full control over my data and don't need internet for core functionality.

#### Acceptance Criteria

1. THE Clover SHALL run all components as native processes or embedded libraries without requiring Docker
2. THE Clover SHALL perform all AI inference locally via Ollama without sending data to cloud providers
3. THE Clover SHALL distribute as a cross-platform desktop application via Tauri for Windows, macOS, and Linux
4. WHILE the system is offline, THE Clover SHALL maintain full functionality for all features except online search, which SHALL fall back to the Offline_Adapter

### Requirement 31: Degradação Graciosa Offline

**User Story:** As a user, I want the system to degrade gracefully when offline, so that I can continue working without internet connectivity.

#### Acceptance Criteria

1. WHILE the Connectivity_Check returns false, THE Search_Service SHALL route all search requests to the Offline_Adapter transparently
2. WHILE the system is offline, THE Clover SHALL maintain full functionality for chat, file operations, terminal, memory, and agent routing
3. THE Clover SHALL not display errors or degrade the user experience for features that do not require internet connectivity

### Requirement 32: Segurança do Exec Guard

**User Story:** As a user, I want a robust command execution guard, so that dangerous commands are blocked before they can cause harm.

#### Acceptance Criteria

1. THE Exec_Guard SHALL check every command against the Deny_List before spawning a subprocess
2. THE Exec_Guard SHALL restrict the working directory of all spawned subprocesses to the Workspace path
3. IF a command exceeds the configured timeout, THEN THE Exec_Guard SHALL terminate the subprocess and return a timeout error
4. THE Deny_List SHALL use regex patterns to match destructive commands and their common variants without producing false positives on standard development commands

### Requirement 33: Configuração Centralizada

**User Story:** As a developer, I want a centralized configuration system, so that all components use consistent settings that can be overridden via environment variables.

#### Acceptance Criteria

1. THE Config module SHALL load settings from `default.config.json` at startup
2. THE Config module SHALL allow environment variable overrides for any configuration value
3. THE Config module SHALL export a typed Config object accessible by all backend components
4. THE models.config.json SHALL define available models with at least one entry with `capabilities:["chat"]` and one with `capabilities:["embed"]`

### Requirement 34: Tipos Compartilhados e Protobuf

**User Story:** As a developer, I want shared type definitions and protobuf contracts, so that UI and backend use the same data structures without duplication.

#### Acceptance Criteria

1. THE shared/types/ package SHALL define TypeScript interfaces for messages, tools, agents, memory, and search contracts
2. THE shared/protos/ package SHALL define the OpenClaude gRPC service with CompletionService, CompletionRequest, CompletionChunk, Message, Tool, ToolCall, and UsageStats
3. THE protobuf definitions SHALL compile without errors via `protoc` and generate TypeScript stubs importable by the backend
4. THE shared/types/ package SHALL contain no `any` types in its interface definitions