/**
 * Clover Backend — application entry point.
 *
 * Boots every subsystem in dependency order, starts the HTTP + WebSocket
 * gateway, and registers graceful shutdown handlers so that all resources
 * are released cleanly on SIGINT / SIGTERM.
 *
 * Initialisation order (respects one-way dependency rule):
 *   1. Config           (already loaded on import)
 *   2. SQLite store     (no deps)
 *   3. LanceDB adapter  (no deps)
 *   4. Session manager  (depends on SQLite store)
 *   5. Tool plugins     (depends on confirmation bus, exec-guard, memory, search)
 *   6. Agent engine     (depends on tool registry, openclaude client)
 *   7. WebSocket server (register on Fastify before listen)
 *   8. HTTP server      (starts Fastify — gateway layer)
 *   9. Vault watcher    (depends on memory service)
 *
 * Dependency direction:
 *   gateway → orchestrator → agents → tools / memory / search
 *   (no circular imports)
 *
 * @module index
 */

import { config } from './config/config.js';
import { SQLiteStore } from './storage/sqlite.store.js';
import * as lancedb from './memory/lancedb.adapter.js';
import * as sessionManager from './orchestrator/session.manager.js';
import * as toolRegistry from './tools/tool-registry.js';
import * as agentEngine from './agents/agent-engine.js';
import * as wsServer from './gateway/ws.server.js';
import { app, start as startHttp, stop as stopHttp } from './gateway/http.server.js';
import * as vaultWatcher from './memory/vault.watcher.js';
import * as taskService from './orchestrator/task.service.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let sqliteStore: SQLiteStore | undefined;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Boot the entire backend stack.
 *
 * Each step is awaited in sequence so that downstream services can rely
 * on their dependencies being fully initialised.
 */
async function boot(): Promise<void> {
  console.log('[boot] Starting Clover backend…');

  // ── 1. Config ───────────────────────────────────────────────────────
  // `config` is resolved at import time — nothing to do here.
  console.log(`[boot] Config loaded (gateway ${config.gateway.host}:${config.gateway.port})`);

  // ── 2. SQLite store ─────────────────────────────────────────────────
  const dbPath = './data/clover.db';
  sqliteStore = new SQLiteStore(dbPath);
  await sqliteStore.ensureReady();
  console.log(`[boot] SQLite store initialised (${dbPath})`);

  // ── 3. LanceDB adapter ─────────────────────────────────────────────
  await lancedb.init(config.memory.dbPath);
  console.log(`[boot] LanceDB initialised (${config.memory.dbPath})`);

  // ── 4. Session manager ──────────────────────────────────────────────
  sessionManager.init(sqliteStore);
  taskService.init(sqliteStore);
  console.log('[boot] Session manager and Task service initialised');

  // ── 5. Tool plugins ─────────────────────────────────────────────────
  await toolRegistry.loadPlugins();
  console.log(`[boot] Tool registry loaded (${toolRegistry.listTools().length} plugins)`);

  // ── 6. Agent engine ─────────────────────────────────────────────────
  await agentEngine.loadAgents();
  console.log(`[boot] Agent engine loaded (${agentEngine.listAgents().length} agents)`);

  // ── 7. WebSocket server (register before listen) ────────────────────
  await wsServer.register(app);
  console.log('[boot] WebSocket server registered');

  // ── 8. HTTP server ──────────────────────────────────────────────────
  await startHttp();
  console.log(`[boot] Gateway listening on http://${config.gateway.host}:${config.gateway.port}`);

  // ── 9. Vault watcher ────────────────────────────────────────────────
  if (config.vault.path) {
    vaultWatcher.start();
    console.log(`[boot] Vault watcher started (${config.vault.path})`);
  } else {
    console.log('[boot] Vault watcher skipped (no vault path configured)');
  }

  console.log('[boot] Clover backend ready ✓');
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Tear down every subsystem in reverse initialisation order so that
 * in-flight requests drain before underlying stores are closed.
 */
async function shutdown(): Promise<void> {
  console.log('[shutdown] Shutting down Clover backend…');

  // Stop accepting new vault events
  vaultWatcher.stop();
  console.log('[shutdown] Vault watcher stopped');

  // Close HTTP + WS gateway (drains in-flight connections)
  await stopHttp();
  console.log('[shutdown] Gateway stopped');

  // Close SQLite store
  if (sqliteStore) {
    sqliteStore.close();
    console.log('[shutdown] SQLite store closed');
  }

  console.log('[shutdown] Clover backend stopped ✓');
}

/**
 * Register OS signal handlers for graceful shutdown.
 *
 * Both SIGINT (Ctrl-C) and SIGTERM (process manager / Docker stop) are
 * handled identically.  The handler removes itself after the first
 * invocation to avoid double-shutdown on repeated signals.
 */
function registerShutdownHandlers(): void {
  let shuttingDown = false;

  const handler = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[shutdown] Received ${signal}`);
    try {
      await shutdown();
      process.exit(0);
    } catch (err) {
      console.error('[shutdown] Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void handler('SIGINT'));
  process.on('SIGTERM', () => void handler('SIGTERM'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

registerShutdownHandlers();

boot().catch((err: unknown) => {
  console.error('[boot] Fatal error during startup:', err);
  process.exit(1);
});
