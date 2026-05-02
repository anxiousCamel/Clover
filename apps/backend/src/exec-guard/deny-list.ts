/**
 * Deny list — regex patterns that block dangerous shell commands.
 *
 * Patterns are designed to catch destructive commands and their common
 * variants while allowing standard development commands through.
 */

/** Blocked command patterns with descriptions. */
export const denyPatterns: { pattern: RegExp; description: string }[] = [
  {
    pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+(-[a-zA-Z]*\s+)*|(-[a-zA-Z]*\s+)*-[a-zA-Z]*f[a-zA-Z]*\s+)\//,
    description: 'rm -rf / (recursive force delete from root)',
  },
  {
    pattern: /\bformat\s+[A-Za-z]:/i,
    description: 'format drive (Windows)',
  },
  {
    pattern: /\bmkfs\b/,
    description: 'mkfs (create filesystem — destroys data)',
  },
  {
    pattern: /\bdd\s+if=/,
    description: 'dd if= (raw disk write)',
  },
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/,
    description: 'fork bomb :(){ :|:& };:',
  },
  {
    pattern: /\.\s*\/dev\/tcp\//,
    description: 'reverse shell via /dev/tcp',
  },
];

/**
 * Check whether a command matches any deny-list pattern.
 * Returns true if the command is denied (blocked).
 */
export function isDenied(command: string): boolean {
  return denyPatterns.some(({ pattern }) => pattern.test(command));
}
