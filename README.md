# CloverOS 🍀

> **Any model. Every tool. Zero limits.**
> A local-first **operating system for AI agents** — not just a coding assistant.
> Plans are compiled to a validated **Intermediate Representation (IR)**, executed
> as a durable **DAG** under **capability-based security**, and observed through a
> single **event bus** — all running on your machine.

CloverOS is built as a **microkernel + plugin** monorepo: a tiny trusted core
(scheduler, capabilities, resource manager, event bus, state) surrounded by
swappable packages (planner, executor, tools, memory, knowledge, sandbox, CLI).
It is designed to stay reliable with **small local models (~8B via Ollama)** by
moving correctness into structure (constrained IR, deterministic validation)
instead of trusting the model to "behave".

- 📐 **Architecture:** [`docs/architecture/cloveros-rap.md`](docs/architecture/cloveros-rap.md)
  (RAP) · ADRs [003](docs/adr/003-runtime-e-modelo-de-execucao.md) ·
  [004](docs/adr/004-ir-vs-codegen.md) · [005](docs/adr/005-modelo-de-estado.md)
- 🛣️ **Live progress:** [`PROGRESS.md`](PROGRESS.md)

---

## Why CloverOS

| Problem with small models | CloverOS answer |
|---|---|
| JSON tool-calling loops / malformed args | Planner emits a **constrained Plan IR** (schema-restricted), validated deterministically — never raw code |
| Context window floods | **Tool Search** + **token-budgeted Context Builder** + **structural retrieval** (AST/KG) instead of raw files |
| Long tasks lost on crash | **Event-sourced journal** + **durable scheduler** with **incremental checkpoint resume** |
| Unsafe command execution | **Capability tokens** (signed, least-privilege) + **Tier-3 process sandbox** (no shell, workspace-bound, timeout) |
| Multi-agent chaos | **Actor model** (isolated mailboxes) + structured **Blackboard** + one **Event Bus** |

---

## Quickstart (copy/paste)

> Requirements: **Node ≥ 18**, **pnpm ≥ 8**, and (for live planning) **[Ollama](https://ollama.com)**.

```bash
# 1. Clone & enter
git clone https://github.com/anxiousCamel/Clover.git
cd Clover

# 2. One-shot idempotent setup (installs deps, builds, checks Ollama + model)
pnpm install
pnpm build:os
pnpm clover:setup            # only does what's missing; safe to re-run

# 3. Launch the interactive REPL
pnpm clover
```

Just want a health check without changing anything?

```bash
node apps/cli/dist/main.js setup --check
```

Run a sandboxed command without the LLM (works offline):

```bash
pnpm clover          # then, inside the REPL:
# > /exec node -e "console.log('hello from the Tier-3 sandbox')"
```

---

## The REPL

A continuous chat loop. Type a task in natural language, or use a slash command.

| Command | Description |
|---|---|
| `/help` | Show the command guide |
| `/model [name]` | List models, or switch the active model |
| `/status` | Kernel health, active model & **provider**, **mode**, **language**, Blackboard stats, token usage |
| `/config` | **Interactive config panel** (raw mode, arrow keys): language, default model, log level, mode |
| `/mode [step\|auto]` | Switch **autonomy** (see below) |
| `/provider` | Add/activate a **cloud provider** (OpenRouter/OpenAI/Groq/…) — API key entered **masked** |
| `/clear` | Clear the screen |
| `/exec <command>` | Run a command in the **Tier-3 sandbox** (asks for contextual authorization in `step` mode) |
| `/exit` | Leave the REPL |

### Autonomy modes (`/mode`)

- **`step`** (default): interactive. Destructive / Tier-3 actions ask for a
  **contextual** confirmation via keyboard before running.
- **`auto`**: uninterrupted. No manual confirmations — the system trusts the
  **programmatic safety barriers** (token budget, `maxTurns`, timeouts). If a task
  hits a safety ceiling, it is **suspended**, its state is **persisted to the
  Blackboard** (for Scheduler recovery), and you're notified in the REPL.

### Languages (i18n)

CloverOS ships **English** and **Português (BR)**. Switch via `/config → Language`
(or set `language` in `~/.cloveros/config.json`). All REPL strings come from
`@clover/i18n`.

Anything else is treated as a **task** for the agent:

```
🍀 > refactor the auth module and add tests
```

### Smart input

- **File / image paths** dragged or pasted into the prompt are intercepted and shown
  as clean tags — `[arquivo: src/index.ts]`, `[imagem: photo.png]` — never raw binary
  strings (`apps/cli` + `@clover/tui`).
- **Human-in-the-loop:** destructive or sandboxed actions raise a **contextual**
  question (not a generic `y/n`), navigated with arrow keys / numbers in **raw mode**
  — the keystroke never leaks onto the screen.
- **Anti-freeze:** a live spinner shows the agent's reasoning phase ("Gerando Plan
  IR…", "Validando gramática/IR…"), active-actor count, and a running token counter.

### Theme & fallbacks (Clover 🍀)

All colors/symbols live in one place (`@clover/tui` `ThemeManager`). The UI degrades
cleanly: it drops ANSI colors on non-TTY/`NO_COLOR`, and switches to ASCII symbols
when the terminal isn't UTF-8 (or when `CLOVER_ASCII=1`), so output never turns to
visual garbage.

---

## Cloud providers (OpenRouter / OpenAI / Groq / DeepSeek)

CloverOS plugs into any **OpenAI-compatible** API via a single adapter — just a
`baseURL` + `apiKey`. Constrained generation is preserved: structured outputs
(`response_format: json_schema`) are used when the provider supports them, with a
graceful `json_object` + schema-in-prompt fallback otherwise.

Add one from the REPL (the API key is typed **masked**, never echoed, and saved
to `~/.cloveros/config.json` with `0600` perms — outside the project):

```
🍀 > /provider
Provider name (e.g. openrouter): openrouter
Base URL (e.g. https://openrouter.ai/api/v1): https://openrouter.ai/api/v1
API Key (hidden input): ****************
Structured outputs? ❯ yes
```

Common base URLs:

| Provider | Base URL |
|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |

The active provider is read **dynamically** from config — switching takes effect
on the next task, no restart needed. Ollama remains the default (local, offline).

---

## How a task flows

```
goal
  → Context Builder   (Tool Search picks relevant tools; AST/KG structural retrieval;
                       everything fit under a strict token budget)
  → Planner           (LLM under constrained decoding → Plan IR; validate → repair loop)
  → Capability Resolver (mints a signed, least-privilege token)
  → Scheduler + Resource Manager (durable submit; bounded concurrency)
  → Execution Engine  (validate → topo-sort → run the DAG; checkpoints; events)
  → Event Bus → Journal (observability == durability; replayable; resumable)
```

Each run is an isolated **actor** with its own `taskId`, so hundreds can run
concurrently without cross-talk while the Resource Manager bounds real parallelism.

---

## Project structure

```
packages/
  contracts          shared TCB types
  event-bus          synchronous pub/sub backbone
  kernel             microkernel facade (boot, tools, submit/execute plan)
  ir                 Plan IR schema + validator + topo-sort + execution levels
  executor           IR VM / DAG runner (Tier 0) with checkpoint resume
  planner            LLM → constrained IR (generate → validate → repair)
  llm                provider port (Mock + Ollama structured outputs)
  state              event store (append-only JSONL) + snapshots + projections
  scheduler          durable scheduler + incremental checkpoint resume
  capability         HMAC-signed least-privilege capability tokens
  resource-manager   concurrency semaphore + timeout + budgets
  sandbox            Tier-3 hardened child_process (no shell, workspace-bound)
  tool-abi           uniform tool contract + registry + bridge
  tool-search        relevance-ranked tool discovery
  context-builder    token-budgeted context assembly with provenance
  agent-runtime      actor model (mailbox, isolation)
  ast-index          structural code index (TypeScript Compiler API)
  knowledge-graph    embedded graph derived from the AST index
  knowledge-retriever structural retrieval → budgeted snippets
  blackboard         structured, versioned shared cognition store
  agent              end-to-end wiring (context → planner → scheduler)
  tui                centralized Clover theme + REPL UI logic
apps/
  cli                the interactive CloverOS REPL (bin: clover)
  backend, ui        legacy Clover app (pre-RAP; being superseded)
docs/                architecture (RAP) + ADRs
```

> The `apps/backend` / `apps/ui` are the **legacy** pre-RAP Clover. The CloverOS
> ecosystem lives under `packages/*` and `apps/cli`.

---

## Development

```bash
pnpm install                       # install the workspace
pnpm build:os                      # tsc --build the CloverOS graph + CLI
pnpm clover:dev                    # run the REPL from source (tsx, no build)

# Tests (Vitest) — per package or all CloverOS packages
pnpm --filter @clover/kernel test
pnpm --filter "@clover/*" -r run test
```

- **Language/runtime:** Node.js + TypeScript (ESM), pnpm workspaces, Vitest.
- **Build:** TypeScript project references (`tsc --build`); each package emits to
  `dist/`. Tests resolve `@clover/*` to source via Vitest aliases (no build needed).

### Configuration

| Env var | Default | Description |
|---|---|---|
| `CLOVER_OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `CLOVER_MODEL` | `qwen2.5-coder` | Default model for planning |
| `NO_COLOR` | — | Disable ANSI colors |
| `CLOVER_ASCII` | — | Force ASCII symbols (no emoji/unicode) |

Persistent user settings (language, default model, log level, autonomy mode, and
cloud-provider credentials) live in **`~/.cloveros/config.json`** (file mode
`0600`), edited via `/config` and `/provider`.

---

## Resilience

CloverOS never ejects a raw Node stack trace at the user. `uncaughtException` and
`unhandledRejection` are intercepted, the crash state is persisted to the
**Blackboard** (for later Scheduler recovery), and the process exits with a polished
message. The full stack goes to the journal/Blackboard, not the screen.

---

## License

MIT
