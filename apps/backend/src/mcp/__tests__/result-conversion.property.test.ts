/**
 * Property-Based Test — Property 5: MCP Result Conversion Preserves Shape
 *
 * **Validates: Requirements 1.4.3, 1.4.4**
 *
 * For any MCP tool response (success with content, or error with message),
 * converting it to Clover's `ToolResult` format SHALL produce an object with
 * `success` boolean, `output` string, and optional `error` string — where
 * success responses have `success: true` and error responses have
 * `success: false` with the error message preserved.
 *
 * Generator strategy:
 *   - Generate MCP response objects with random content arrays (text parts,
 *     non-text parts, empty arrays) and random isError flags.
 *   - Verify the converted ToolResult has the correct shape in all cases.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { convertMCPResult } from '../connector.js';
import type { MCPCallToolResult } from '../connector.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generate a single text content part with arbitrary text. */
const textContentPartArb = fc.record({
  type: fc.constant('text'),
  text: fc.string({ minLength: 0, maxLength: 200 }),
});

/** Generate a non-text content part (e.g., image, resource). */
const nonTextContentPartArb = fc.record({
  type: fc.constantFrom('image', 'resource', 'blob', 'binary'),
  // text may or may not be present on non-text parts
  text: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
});

/** Generate a mixed content array with at least one text part. */
const contentArrayWithTextArb = fc
  .tuple(
    fc.array(textContentPartArb, { minLength: 1, maxLength: 5 }),
    fc.array(nonTextContentPartArb, { minLength: 0, maxLength: 3 }),
  )
  .chain(([textParts, nonTextParts]) =>
    fc.shuffledSubarray([...textParts, ...nonTextParts], {
      minLength: textParts.length + nonTextParts.length,
      maxLength: textParts.length + nonTextParts.length,
    }),
  );

/** Generate an empty content array. */
const emptyContentArb = fc.constant([] as Array<{ type: string; text?: string }>);

/** Generate a content array with only non-text parts. */
const nonTextOnlyContentArb = fc.array(nonTextContentPartArb, { minLength: 1, maxLength: 5 });

/** Generate any valid content array. */
const anyContentArb = fc.oneof(contentArrayWithTextArb, emptyContentArb, nonTextOnlyContentArb);

/** Generate a success MCP response (isError is false or undefined). */
const successResponseArb: fc.Arbitrary<MCPCallToolResult> = anyContentArb.map((content) => ({
  content,
  isError: false,
}));

/** Generate an error MCP response (isError is true). */
const errorResponseArb: fc.Arbitrary<MCPCallToolResult> = anyContentArb.map((content) => ({
  content,
  isError: true,
}));

/** Generate any MCP response (success or error). */
const anyResponseArb: fc.Arbitrary<MCPCallToolResult> = fc.oneof(
  successResponseArb,
  errorResponseArb,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the expected text output from an MCP response's content array.
 * Mirrors the conversion logic: filter text parts, join with newlines.
 */
function expectedTextOutput(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text as string)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 5: MCP Result Conversion Preserves Shape', () => {
  it('success responses produce { success: true, output } with text content joined (Req 1.4.3)', () => {
    fc.assert(
      fc.property(successResponseArb, (mcpResult) => {
        const toolResult = convertMCPResult(mcpResult);

        // Shape: success must be true
        expect(toolResult.success).toBe(true);

        // Output must be a string
        expect(typeof toolResult.output).toBe('string');

        // Output must equal the joined text parts
        const expected = expectedTextOutput(mcpResult.content);
        expect(toolResult.output).toBe(expected);

        // No error field on success (should be undefined)
        expect(toolResult.error).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('error responses produce { success: false, error } with error message preserved (Req 1.4.4)', () => {
    fc.assert(
      fc.property(errorResponseArb, (mcpResult) => {
        const toolResult = convertMCPResult(mcpResult);

        // Shape: success must be false
        expect(toolResult.success).toBe(false);

        // Output must be empty string for errors
        expect(toolResult.output).toBe('');

        // Error must be a string
        expect(typeof toolResult.error).toBe('string');

        // Error must contain the text content or fallback message
        const textOutput = expectedTextOutput(mcpResult.content);
        if (textOutput) {
          expect(toolResult.error).toBe(textOutput);
        } else {
          // Fallback message when no text content
          expect(toolResult.error).toBe('MCP tool returned an error with no message.');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('converted result always has correct shape regardless of content (Req 1.4.3, 1.4.4)', () => {
    fc.assert(
      fc.property(anyResponseArb, (mcpResult) => {
        const toolResult = convertMCPResult(mcpResult);

        // Shape invariants that must always hold
        expect(typeof toolResult.success).toBe('boolean');
        expect(typeof toolResult.output).toBe('string');

        // success and error are mutually consistent
        if (toolResult.success) {
          expect(toolResult.error).toBeUndefined();
        } else {
          expect(typeof toolResult.error).toBe('string');
          expect(toolResult.error!.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
