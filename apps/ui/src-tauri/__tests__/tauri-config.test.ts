/**
 * Unit tests for Tauri filesystem restriction configuration.
 *
 * Validates: Requirements 26.1, 26.4
 *
 * - 26.1: THE Tauri_Shell SHALL configure `fs.scope` in tauri.conf.json to
 *         restrict filesystem access to the Workspace path only.
 * - 26.4: IF a Tauri filesystem invoke targets a path outside the Workspace,
 *         THEN THE Tauri_Shell SHALL reject the operation with a permission error.
 *
 * Since Tauri's filesystem restrictions are enforced at the Rust/native level,
 * these tests validate the configuration structure to ensure the security
 * settings are correctly defined.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface TauriConfig {
  tauri: {
    allowlist: {
      all: boolean;
      fs: {
        all: boolean;
        readFile: boolean;
        writeFile: boolean;
        readDir: boolean;
        createDir: boolean;
        removeDir: boolean;
        removeFile: boolean;
        renameFile: boolean;
        exists: boolean;
        scope: string[];
      };
      shell: {
        all: boolean;
        open: boolean;
      };
      [key: string]: unknown;
    };
    security: {
      csp: string;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

describe('Tauri filesystem restriction configuration', () => {
  let config: TauriConfig;

  beforeAll(() => {
    const configPath = resolve(__dirname, '..', 'tauri.conf.json');
    const raw = readFileSync(configPath, 'utf-8');
    config = JSON.parse(raw) as TauriConfig;
  });

  // ── Requirement 26.1: fs.scope restricts access ────────────────────

  describe('fs.scope configuration (Req 26.1)', () => {
    it('should define an fs.scope array to restrict filesystem access', () => {
      const scope = config.tauri.allowlist.fs.scope;
      expect(scope).toBeDefined();
      expect(Array.isArray(scope)).toBe(true);
      expect(scope.length).toBeGreaterThan(0);
    });

    it('should not include a wildcard scope that grants unrestricted access', () => {
      const scope = config.tauri.allowlist.fs.scope;
      // A bare "**" or "*" would grant access to the entire filesystem
      const hasUnrestrictedWildcard = scope.some(
        (s) => s === '**' || s === '*' || s === '/**',
      );
      expect(hasUnrestrictedWildcard).toBe(false);
    });

    it('should scope filesystem access to known safe directories only', () => {
      const scope = config.tauri.allowlist.fs.scope;
      // Each scope entry should use a Tauri variable prefix ($APPDATA, $RESOURCE, etc.)
      // rather than an absolute path that could expose the full filesystem
      for (const entry of scope) {
        const usesTauriVariable = entry.startsWith('$');
        expect(usesTauriVariable).toBe(true);
      }
    });
  });

  // ── Requirement 26.4: restrictive allowlist prevents broad access ──

  describe('allowlist restrictions (Req 26.4)', () => {
    it('should set allowlist.all to false to deny all APIs by default', () => {
      expect(config.tauri.allowlist.all).toBe(false);
    });

    it('should set allowlist.fs.all to false to deny blanket filesystem access', () => {
      expect(config.tauri.allowlist.fs.all).toBe(false);
    });

    it('should disable dangerous filesystem operations (removeDir, removeFile, renameFile)', () => {
      const fs = config.tauri.allowlist.fs;
      expect(fs.removeDir).toBe(false);
      expect(fs.removeFile).toBe(false);
      expect(fs.renameFile).toBe(false);
    });

    it('should disable shell.all to prevent unrestricted shell access', () => {
      expect(config.tauri.allowlist.shell.all).toBe(false);
    });

    it('should disable shell.open to prevent arbitrary URL/program opening', () => {
      expect(config.tauri.allowlist.shell.open).toBe(false);
    });
  });

  // ── CSP security header ────────────────────────────────────────────

  describe('Content Security Policy', () => {
    it('should define a CSP that restricts default-src to self', () => {
      const csp = config.tauri.security.csp;
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
    });

    it('should restrict connect-src to localhost only', () => {
      const csp = config.tauri.security.csp;
      expect(csp).toContain('connect-src');
      // Should only allow self and localhost connections
      expect(csp).not.toMatch(/connect-src[^;]*https?:\/\/(?!localhost)/);
    });
  });
});
