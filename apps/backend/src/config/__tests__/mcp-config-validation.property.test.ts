/**
 * Property-Based Test — Property 1: MCP Config Schema Validation Round-Trip
 *
 * **Validates: Requirements 1.1.1, 1.1.2, 1.1.3, 1.1.4, 1.1.5, 1.1.6**
 *
 * For any MCPServerConfig object:
 *   - If it has a valid name, correct transport type with matching required
 *     fields (command for stdio, url for sse), the Zod schema SHALL accept it.
 *   - If any required field is missing or transport-specific constraints are
 *     violated, the schema SHALL reject it with a descriptive error.
 *
 * Generator strategy:
 *   - Generate MCPServerConfig objects with random names, transports, and
 *     optional fields.  Mutate valid configs to create invalid variants
 *     (missing command for stdio, missing url for sse, empty name, etc.).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { mcpServerConfigSchema } from '../config.js';

// ---------------------------------------------------------------------------
// Arbitraries — generators for valid and invalid configs
// ---------------------------------------------------------------------------

/** Non-empty alphanumeric string suitable for server names / commands. */
const nonEmptyString = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,19}$/);

/** Generate a syntactically valid URL (http or https). */
const validUrl = fc.tuple(
  fc.constantFrom('http', 'https'),
  fc.stringMatching(/^[a-z]{2,10}$/),
  fc.constantFrom('.com', '.io', '.dev', '.org'),
).map(([scheme, host, tld]) => `${scheme}://${host}${tld}`);

/** Optional auth object. */
const optionalAuth = fc.option(
  fc.record({ token: fc.string({ minLength: 1, maxLength: 64 }) }),
  { nil: undefined },
);

/** Optional positive integer for timeoutMs. */
const optionalTimeout = fc.option(
  fc.integer({ min: 1, max: 120_000 }),
  { nil: undefined },
);

/** Optional string array for args. */
const optionalArgs = fc.option(
  fc.array(fc.string({ minLength: 0, maxLength: 20 }), { minLength: 0, maxLength: 5 }),
  { nil: undefined },
);

/**
 * Generate a fully valid stdio MCPServerConfig.
 * Req 1.1.2: stdio transport requires `command`.
 */
const validStdioConfig = fc.record({
  name: nonEmptyString,
  transport: fc.constant('stdio' as const),
  command: nonEmptyString,
  args: optionalArgs,
  url: fc.constant(undefined),
  auth: optionalAuth,
  timeoutMs: optionalTimeout,
});

/**
 * Generate a fully valid SSE MCPServerConfig.
 * Req 1.1.3: sse transport requires `url`.
 */
const validSseConfig = fc.record({
  name: nonEmptyString,
  transport: fc.constant('sse' as const),
  command: fc.constant(undefined),
  args: fc.constant(undefined),
  url: validUrl,
  auth: optionalAuth,
  timeoutMs: optionalTimeout,
});

/** Any valid MCPServerConfig (stdio or sse). */
const validConfig = fc.oneof(validStdioConfig, validSseConfig);

// ---------------------------------------------------------------------------
// Mutation helpers — create invalid variants from valid configs
// ---------------------------------------------------------------------------

type AnyConfig = Record<string, unknown>;

/** Remove the `command` field from a stdio config → should be rejected. */
function removeCommand(cfg: AnyConfig): AnyConfig {
  const copy = { ...cfg };
  delete copy.command;
  return copy;
}

/** Remove the `url` field from an sse config → should be rejected. */
function removeUrl(cfg: AnyConfig): AnyConfig {
  const copy = { ...cfg };
  delete copy.url;
  return copy;
}

/** Set name to empty string → should be rejected (min 1). */
function emptyName(cfg: AnyConfig): AnyConfig {
  return { ...cfg, name: '' };
}

/** Set transport to an invalid value. */
function invalidTransport(cfg: AnyConfig): AnyConfig {
  return { ...cfg, transport: 'grpc' };
}

/** Set timeoutMs to a non-positive number. */
function invalidTimeout(cfg: AnyConfig): AnyConfig {
  return { ...cfg, timeoutMs: -1 };
}

/** Set url to a non-URL string for sse transport. */
function invalidUrl(cfg: AnyConfig): AnyConfig {
  return { ...cfg, transport: 'sse', url: 'not-a-url' };
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 1: MCP Config Schema Validation Round-Trip', () => {
  // ── Valid configs are accepted ──────────────────────────────────────

  it('should accept any valid stdio config with command field (Req 1.1.1, 1.1.2, 1.1.6)', () => {
    fc.assert(
      fc.property(validStdioConfig, (cfg) => {
        // Strip undefined keys so Zod doesn't see explicit undefined
        const clean = JSON.parse(JSON.stringify(cfg));
        const result = mcpServerConfigSchema.safeParse(clean);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should accept any valid sse config with url field (Req 1.1.1, 1.1.3, 1.1.6)', () => {
    fc.assert(
      fc.property(validSseConfig, (cfg) => {
        const clean = JSON.parse(JSON.stringify(cfg));
        const result = mcpServerConfigSchema.safeParse(clean);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should accept configs with optional auth object (Req 1.1.4)', () => {
    const configWithAuth = fc.record({
      name: nonEmptyString,
      transport: fc.constant('stdio' as const),
      command: nonEmptyString,
      auth: fc.record({ token: fc.string({ minLength: 1, maxLength: 64 }) }),
    });

    fc.assert(
      fc.property(configWithAuth, (cfg) => {
        const result = mcpServerConfigSchema.safeParse(cfg);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // ── Invalid configs are rejected with descriptive errors ───────────

  it('should reject stdio config missing command field (Req 1.1.2, 1.1.5)', () => {
    fc.assert(
      fc.property(validStdioConfig, (cfg) => {
        const invalid = removeCommand(JSON.parse(JSON.stringify(cfg)));
        const result = mcpServerConfigSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message).join(' ');
          expect(messages).toContain('stdio transport requires "command" field');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should reject sse config missing url field (Req 1.1.3, 1.1.5)', () => {
    fc.assert(
      fc.property(validSseConfig, (cfg) => {
        const invalid = removeUrl(JSON.parse(JSON.stringify(cfg)));
        const result = mcpServerConfigSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message).join(' ');
          expect(messages).toContain('sse transport requires "url" field');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should reject config with empty name (Req 1.1.1, 1.1.5)', () => {
    fc.assert(
      fc.property(validConfig, (cfg) => {
        const invalid = emptyName(JSON.parse(JSON.stringify(cfg)));
        const result = mcpServerConfigSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('should reject config with invalid transport type (Req 1.1.1, 1.1.5)', () => {
    fc.assert(
      fc.property(validConfig, (cfg) => {
        const invalid = invalidTransport(JSON.parse(JSON.stringify(cfg)));
        const result = mcpServerConfigSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('should reject config with non-positive timeoutMs (Req 1.1.5)', () => {
    fc.assert(
      fc.property(validConfig, (cfg) => {
        const invalid = invalidTimeout(JSON.parse(JSON.stringify(cfg)));
        const result = mcpServerConfigSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('should reject sse config with invalid url string (Req 1.1.3, 1.1.5)', () => {
    fc.assert(
      fc.property(validSseConfig, (cfg) => {
        const invalid = invalidUrl(JSON.parse(JSON.stringify(cfg)));
        const result = mcpServerConfigSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // ── Round-trip: generate valid → validate passes; mutate → validate fails ──

  it('should round-trip: valid configs pass, then mutated variants fail (Req 1.1.5, 1.1.6)', () => {
    /** Transport-aware mutations that always produce an invalid config. */
    const stdioMutations = fc.constantFrom(
      removeCommand,  // stdio without command → invalid
      emptyName,
      invalidTransport,
      invalidTimeout,
    );

    const sseMutations = fc.constantFrom(
      removeUrl,      // sse without url → invalid
      emptyName,
      invalidTransport,
      invalidTimeout,
    );

    // Test stdio configs with stdio-relevant mutations
    fc.assert(
      fc.property(validStdioConfig, stdioMutations, (cfg, mutate) => {
        const clean = JSON.parse(JSON.stringify(cfg));

        // Valid config must pass
        const validResult = mcpServerConfigSchema.safeParse(clean);
        expect(validResult.success).toBe(true);

        // Mutated config must fail
        const invalid = mutate(clean);
        const invalidResult = mcpServerConfigSchema.safeParse(invalid);
        expect(invalidResult.success).toBe(false);

        // Error must be descriptive (non-empty message)
        if (!invalidResult.success) {
          expect(invalidResult.error.issues.length).toBeGreaterThan(0);
          expect(invalidResult.error.issues[0]!.message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );

    // Test sse configs with sse-relevant mutations
    fc.assert(
      fc.property(validSseConfig, sseMutations, (cfg, mutate) => {
        const clean = JSON.parse(JSON.stringify(cfg));

        // Valid config must pass
        const validResult = mcpServerConfigSchema.safeParse(clean);
        expect(validResult.success).toBe(true);

        // Mutated config must fail
        const invalid = mutate(clean);
        const invalidResult = mcpServerConfigSchema.safeParse(invalid);
        expect(invalidResult.success).toBe(false);

        // Error must be descriptive (non-empty message)
        if (!invalidResult.success) {
          expect(invalidResult.error.issues.length).toBeGreaterThan(0);
          expect(invalidResult.error.issues[0]!.message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
