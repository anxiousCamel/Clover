import { readFile, writeFile, access, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config } from '../config/config.js';

/** Write modes for vault note operations. */
export type WriteMode = 'create-only' | 'append' | 'overwrite';

/**
 * Resolve a relative file path against the configured vault root.
 * Throws if the resolved path escapes the vault directory.
 */
function resolveVaultPath(filePath: string): string {
  const vaultRoot = resolve(config.vault.path);
  const resolved = resolve(vaultRoot, filePath);

  if (!resolved.startsWith(vaultRoot)) {
    throw new Error(
      `Path "${filePath}" resolves outside the vault boundary`,
    );
  }
  return resolved;
}

/**
 * Check whether a file exists at the given absolute path.
 */
async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a markdown file from the Obsidian vault.
 * @param filePath - path relative to vault root
 * @returns file content as UTF-8 string
 */
export async function read(filePath: string): Promise<string> {
  const absPath = resolveVaultPath(filePath);
  return readFile(absPath, 'utf-8');
}

/**
 * Write a note to the Obsidian vault with safety rules per mode.
 *
 * - **create-only** — create file only if it does not exist; error if it does.
 * - **append** — append content with `\n---\n` separator; no confirmation.
 * - **overwrite** — requires confirmation via `confirmFn`; creates `.bak` backup first.
 *
 * @param filePath  - path relative to vault root
 * @param content   - markdown content to write
 * @param mode      - write mode
 * @param confirmFn - confirmation callback (required for overwrite mode)
 */
export async function writeNote(
  filePath: string,
  content: string,
  mode: WriteMode,
  confirmFn?: () => Promise<boolean>,
): Promise<void> {
  const absPath = resolveVaultPath(filePath);

  switch (mode) {
    case 'create-only': {
      if (await fileExists(absPath)) {
        throw new Error(
          `File already exists: "${filePath}". Use "append" or "overwrite" mode.`,
        );
      }
      await writeFile(absPath, content, 'utf-8');
      break;
    }

    case 'append': {
      const existing = await readFile(absPath, 'utf-8');
      const merged = existing + '\n---\n' + content;
      await writeFile(absPath, merged, 'utf-8');
      break;
    }

    case 'overwrite': {
      if (!confirmFn) {
        throw new Error(
          'Overwrite mode requires a confirmation function.',
        );
      }

      const approved = await confirmFn();
      if (!approved) {
        throw new Error('Overwrite denied by user.');
      }

      // Create .bak backup before writing
      if (await fileExists(absPath)) {
        await copyFile(absPath, absPath + '.bak');
      }

      await writeFile(absPath, content, 'utf-8');
      break;
    }

    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown write mode: ${_exhaustive}`);
    }
  }
}
