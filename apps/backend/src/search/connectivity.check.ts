/**
 * Connectivity check — determines if the machine is online
 * by sending a HEAD request to DuckDuckGo with a 2-second timeout.
 */

const PROBE_URL = 'https://duckduckgo.com';
const TIMEOUT_MS = 2_000;

/**
 * Returns true when the machine can reach the internet, false otherwise.
 * Uses native fetch with an AbortController-based timeout.
 */
export async function isOnline(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    await fetch(PROBE_URL, {
      method: 'HEAD',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
