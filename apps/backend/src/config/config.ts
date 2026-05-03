import type { Config } from '@clover/shared';
import { z } from 'zod';
import defaultConfig from '../../../../config/default.config.json' with { type: 'json' };

/**
 * Convert a nested config path like "gateway.port" to env var name "CLOVER_GATEWAY_PORT".
 */
function toEnvKey(path: string): string {
  return 'CLOVER_' + path.replace(/\./g, '_').toUpperCase();
}

/**
 * Coerce a string env value to match the type of the default value.
 */
function coerce(envValue: string, defaultValue: unknown): unknown {
  if (typeof defaultValue === 'number') {
    const num = Number(envValue);
    if (!Number.isNaN(num)) return num;
  }
  if (typeof defaultValue === 'boolean') {
    return envValue === 'true' || envValue === '1';
  }
  return envValue;
}

/**
 * Recursively apply env var overrides to a config object.
 * For each leaf value, check if CLOVER_<PATH> env var exists.
 */
function applyEnvOverrides<T extends Record<string, unknown>>(
  obj: T,
  prefix: string,
): T {
  const result = { ...obj };

  for (const key of Object.keys(result)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = result[key];

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      (result as Record<string, unknown>)[key] = applyEnvOverrides(
        value as Record<string, unknown>,
        path,
      );
    } else {
      const envKey = toEnvKey(path);
      const envValue = process.env[envKey];
      if (envValue !== undefined) {
        (result as Record<string, unknown>)[key] = coerce(envValue, value);
      }
    }
  }

  return result;
}

export const config: Config = applyEnvOverrides(
  defaultConfig as unknown as Record<string, unknown>,
  '',
) as unknown as Config;

// ---------------------------------------------------------------------------
// MCP Server Config — Zod validation schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for validating individual MCP server configuration entries.
 * Enforces transport-specific constraints:
 *   - stdio transport requires a `command` field
 *   - sse transport requires a `url` field
 *
 * Exported so the MCP connector can reuse it at runtime.
 */
export const mcpServerConfigSchema = z
  .object({
    name: z.string().min(1),
    transport: z.enum(['stdio', 'sse']),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().url().optional(),
    auth: z.object({ token: z.string() }).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .refine((cfg) => cfg.transport !== 'stdio' || !!cfg.command, {
    message: 'stdio transport requires "command" field',
  })
  .refine((cfg) => cfg.transport !== 'sse' || !!cfg.url, {
    message: 'sse transport requires "url" field',
  });

// ---------------------------------------------------------------------------
// Startup validation — validate mcpServers entries if present
// ---------------------------------------------------------------------------

if (config.mcpServers && config.mcpServers.length > 0) {
  for (const entry of config.mcpServers) {
    const result = mcpServerConfigSchema.safeParse(entry);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message).join('; ');
      throw new Error(
        `Invalid MCP server config "${entry.name ?? '(unnamed)'}": ${issues}`,
      );
    }
  }
}
