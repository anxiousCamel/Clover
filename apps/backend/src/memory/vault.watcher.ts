import { watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config/config.js';
import { indexFile } from './memory.service.js';

let watcher: FSWatcher | null = null;
const pending = new Map<string, NodeJS.Timeout>();

/**
 * Start watching the configured vault path for .md file changes.
 * Debounces events per file and triggers incremental re-indexing.
 *
 * @param emitEvent Optional callback to emit WebSocket events (e.g. memory:indexed).
 */
export function start(
  emitEvent?: (type: string, data: unknown) => void,
): void {
  if (watcher) return; // already watching

  const vaultPath = resolve(config.vault.path);
  const debounceMs = config.vault.watchDebounceMs;

  watcher = watch(vaultPath, { recursive: true }, (_event, filename) => {
    if (!filename || !filename.endsWith('.md')) return;

    const filePath = resolve(vaultPath, filename);

    // Clear any existing debounce timer for this file
    const existing = pending.get(filePath);
    if (existing) clearTimeout(existing);

    pending.set(
      filePath,
      setTimeout(() => {
        pending.delete(filePath);
        indexFile(filePath)
          .then(() => {
            emitEvent?.('memory:indexed', {
              source: 'vault',
              path: filePath,
            });
          })
          .catch((err: unknown) => {
            console.error(
              `[vault-watcher] Failed to index ${filePath}:`,
              err,
            );
          });
      }, debounceMs),
    );
  });

  watcher.on('error', (err) => {
    console.error('[vault-watcher] Watcher error:', err);
  });
}

/**
 * Stop watching the vault and clear all pending debounce timers.
 */
export function stop(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  for (const timer of pending.values()) {
    clearTimeout(timer);
  }
  pending.clear();
}
