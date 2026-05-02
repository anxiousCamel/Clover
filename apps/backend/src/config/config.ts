import type { Config } from '@clover/shared';
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
