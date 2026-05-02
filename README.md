# Clover

> 🍀 Any model. Every tool. Zero limits.

Clover is a local-first AI coding assistant that runs entirely on your machine. It connects to any LLM backend (Ollama, OpenAI-compatible APIs) and provides autonomous task execution with built-in safety, tool orchestration, and persistent memory.

## Features

- **Multi-Agent Architecture** — Specialized agents (general, coder) with automatic intent routing
- **Tool System** — File read/write/edit, directory listing, command execution, web search, semantic memory
- **Safety First** — Automatic file snapshots before writes, user confirmation for destructive operations, workspace boundary enforcement
- **Persistent Sessions** — SQLite-backed conversation history and task state management
- **Context Compression** — Automatic history pruning to stay within model context windows
- **Streaming** — Real-time token streaming from Ollama for responsive interactions

## Quick Start

```bash
# Install dependencies
pnpm install

# Run the CLI
pnpm clover
```

## Project Structure

```
apps/backend/     — Core backend: agents, tools, orchestrator, Ollama client
shared/           — Shared types and interfaces
config/           — Default configuration (default.config.json)
scripts/          — Build and utility scripts
```

## Configuration

Environment variables override defaults from `config/default.config.json`:

| Variable | Default | Description |
|---|---|---|
| `CLOVER_OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `CLOVER_GATEWAY_PORT` | `3001` | Gateway server port |

## License

MIT