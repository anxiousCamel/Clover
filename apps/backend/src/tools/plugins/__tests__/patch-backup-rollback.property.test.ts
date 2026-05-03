/**
 * Property-Based Test — Property 10: Backup-Rollback Round-Trip
 *
 * **Validates: Requirements 2.3.4**
 *
 * For any file content, applying a patch and then calling `rollback(filePath)`
 * SHALL restore the file to its exact original content (byte-for-byte).
 *
 * Generator strategy:
 *   - Generate random file content (multi-line, varying lengths).
 *   - Embed a unique needle exactly once so the patch is valid.
 *   - Write the file to a temp directory, apply the patch (which creates a
 *     snapshot), then call rollback and verify byte-for-byte restoration.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyPatch } from '../apply-patch.tool.js';
import type { PatchInput } from '../apply-patch.tool.js';
import { rollback } from '../rollback-file.tool.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_ID = 'test-session-rollback';
const FILE_NAME = 'target.txt';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a "needle" string that won't accidentally appear in random
 * filler content. Uses a distinctive delimiter pattern.
 */
const needleArb = fc
  .stringMatching(/^[a-zA-Z0-9]{3,15}$/)
  .map((s) => `<<${s}>>`);

/**
 * Generate a replacement string (single or multi-line, LF-only internally).
 */
const replacementArb = fc
  .array(fc.stringMatching(/^[a-z]{1,30}$/), { minLength: 1, maxLength: 4 })
  .map((lines) => lines.join('\n'));

/**
 * Generate filler lines that do NOT contain the needle.
 */
function fillerLinesArb(needle: string, minLines: number, maxLines: number) {
  return fc
    .array(fc.stringMatching(/^[a-z]{1,40}$/), {
      minLength: minLines,
      maxLength: maxLines,
    })
    .filter((lines) => lines.every((line) => !line.includes(needle)));
}

/**
 * Create a snapshot backup of the file (mirrors the logic in apply-patch.tool.ts).
 * We replicate the snapshot creation here because `createSnapshot` is not exported.
 */
async function createSnapshot(
  resolvedPath: string,
  workspacePath: string,
  sessionId: string,
): Promise<void> {
  const snapshotDir = path.join(
    workspacePath,
    '.clover',
    'snapshots',
    sessionId,
  );
  await fs.mkdir(snapshotDir, { recursive: true });
  const snapshotFile = path.join(
    snapshotDir,
    `${path.basename(resolvedPath)}.${Date.now()}.bak`,
  );
  await fs.copyFile(resolvedPath, snapshotFile);
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 10: Backup-Rollback Round-Trip', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clover-rollback-test-'));
  });

  afterEach(async () => {
    // Retry cleanup to handle Windows file-locking edge cases
    for (let i = 0; i < 3; i++) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 3 });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  });

  // -------------------------------------------------------------------------
  // Core round-trip property: patch then rollback restores original content
  // -------------------------------------------------------------------------
  it('should restore file to exact original content after patch + rollback', () => {
    return fc.assert(
      fc.asyncProperty(
        needleArb,
        replacementArb,
        fillerLinesArb('<<>>', 2, 10),
        fillerLinesArb('<<>>', 0, 10),
        async (needle, replacement, beforeLines, afterLines) => {
          // Ensure filler doesn't contain the needle
          const safeBefore = beforeLines.filter((l) => !l.includes(needle));
          const safeAfter = afterLines.filter((l) => !l.includes(needle));
          if (safeBefore.length < 1) return; // need at least 1 line before

          // Build original file content with needle embedded once
          const allLines = [...safeBefore, needle, ...safeAfter];
          const originalContent = allLines.join('\n');

          // Write original file to temp directory
          const filePath = path.join(tmpDir, FILE_NAME);
          await fs.writeFile(filePath, originalContent, 'utf-8');

          // Create snapshot (backup) of the original file
          await createSnapshot(filePath, tmpDir, SESSION_ID);

          // Apply the patch (pure function — returns patched content)
          const input: PatchInput = {
            filePath: FILE_NAME,
            searchString: needle,
            replaceString: replacement,
            flexibleIndent: false,
          };
          const result = applyPatch(originalContent, input, FILE_NAME);

          // Write patched content to the file
          await fs.writeFile(filePath, result.patched, 'utf-8');

          // Verify the file was actually changed
          const patchedOnDisk = await fs.readFile(filePath, 'utf-8');
          expect(patchedOnDisk).toBe(result.patched);

          // Rollback — restore from the most recent backup
          const backupPath = await rollback(FILE_NAME, tmpDir, SESSION_ID);
          expect(backupPath).toBeDefined();

          // Read the restored file
          const restoredContent = await fs.readFile(filePath, 'utf-8');

          // Verify byte-for-byte restoration
          expect(restoredContent).toBe(originalContent);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Round-trip with both LF and CRLF line endings + Buffer comparison
  // -------------------------------------------------------------------------
  it('should restore file byte-for-byte for any line ending style (LF or CRLF)', () => {
    return fc.assert(
      fc.asyncProperty(
        needleArb,
        replacementArb,
        fillerLinesArb('<<>>', 2, 15),
        fillerLinesArb('<<>>', 0, 10),
        fc.constantFrom('\r\n' as const, '\n' as const),
        async (needle, replacement, beforeLines, afterLines, lineEnding) => {
          // Ensure filler doesn't contain the needle
          const safeBefore = beforeLines.filter((l) => !l.includes(needle));
          const safeAfter = afterLines.filter((l) => !l.includes(needle));
          if (safeBefore.length < 1) return; // need at least 1 line before

          // Build original file content with chosen line ending
          const allLines = [...safeBefore, needle, ...safeAfter];
          const originalContent = allLines.join(lineEnding);

          // Write original file to temp directory
          const filePath = path.join(tmpDir, FILE_NAME);
          await fs.writeFile(filePath, originalContent, 'utf-8');

          // Create snapshot (backup) of the original file
          await createSnapshot(filePath, tmpDir, SESSION_ID);

          // Apply the patch
          const input: PatchInput = {
            filePath: FILE_NAME,
            searchString: needle,
            replaceString: replacement,
            flexibleIndent: false,
          };
          const result = applyPatch(originalContent, input, FILE_NAME);

          // Write patched content to the file
          await fs.writeFile(filePath, result.patched, 'utf-8');

          // Rollback — restore from the most recent backup
          const backupPath = await rollback(FILE_NAME, tmpDir, SESSION_ID);
          expect(backupPath).toBeDefined();

          // Read the restored file
          const restoredContent = await fs.readFile(filePath, 'utf-8');

          // Verify byte-for-byte restoration
          expect(restoredContent).toBe(originalContent);

          // Also verify using Buffer comparison for true byte-for-byte check
          const originalBuf = Buffer.from(originalContent, 'utf-8');
          const restoredBuf = Buffer.from(restoredContent, 'utf-8');
          expect(originalBuf.equals(restoredBuf)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
