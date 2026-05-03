/**
 * Property-Based Test — Property 12: Patch vs Rewrite Threshold
 *
 * **Validates: Requirements 2.5.4**
 *
 * For any file of length L and for any edit affecting E lines,
 * when E/L < 0.30 the ParamExtractor SHALL prefer the PatchEngine;
 * when E/L ≥ 0.30 the ParamExtractor MAY use full file rewrite.
 *
 * Generator strategy:
 *   - Generate file length L (10–10000) and edit size E (1–L).
 *   - Verify shouldPreferPatch returns true when E/L < 0.30
 *     and false when E/L >= 0.30.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { shouldPreferPatch } from '../param.extractor.js';

describe('Property 12: Patch vs Rewrite Threshold', () => {
  // -------------------------------------------------------------------------
  // When E/L < 0.30, PatchEngine is preferred (Req 2.5.4)
  // -------------------------------------------------------------------------
  it('should prefer PatchEngine when editSize / fileLength < 0.30', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 10_000 }),
        fc.double({ min: 0.001, max: 0.299, noNaN: true }),
        (fileLength, ratio) => {
          const editSize = Math.max(1, Math.floor(fileLength * ratio));
          // Guard: ensure the ratio is actually below 0.30 after rounding
          if (editSize / fileLength >= 0.30) return;

          const result = shouldPreferPatch(fileLength, editSize);
          expect(result).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // When E/L >= 0.30, full rewrite may be used (Req 2.5.4)
  // -------------------------------------------------------------------------
  it('should not prefer PatchEngine when editSize / fileLength >= 0.30', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 10_000 }),
        fc.double({ min: 0.30, max: 1.0, noNaN: true }),
        (fileLength, ratio) => {
          const editSize = Math.max(1, Math.ceil(fileLength * ratio));
          // Guard: ensure the ratio is actually at or above 0.30 after rounding
          if (editSize / fileLength < 0.30) return;

          const result = shouldPreferPatch(fileLength, editSize);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Edge case: fileLength <= 0 always returns false
  // -------------------------------------------------------------------------
  it('should return false when fileLength is zero or negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 0 }),
        fc.integer({ min: 0, max: 1000 }),
        (fileLength, editSize) => {
          const result = shouldPreferPatch(fileLength, editSize);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Boundary: ratio exactly at 0.30 threshold
  // -------------------------------------------------------------------------
  it('should not prefer PatchEngine when ratio is exactly 0.30', () => {
    fc.assert(
      fc.property(
        // Use multiples of 10 so that 30% is an exact integer
        fc.integer({ min: 1, max: 1000 }).map((n) => n * 10),
        (fileLength) => {
          const editSize = fileLength * 0.30;
          // editSize / fileLength === 0.30 exactly, which is NOT < 0.30
          const result = shouldPreferPatch(fileLength, editSize);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Unified property: threshold decision is consistent with E/L ratio
  // -------------------------------------------------------------------------
  it('should return true iff editSize/fileLength < 0.30 (for positive fileLength)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (fileLength, editSize) => {
          const ratio = editSize / fileLength;
          const result = shouldPreferPatch(fileLength, editSize);
          expect(result).toBe(ratio < 0.30);
        },
      ),
      { numRuns: 100 },
    );
  });
});
