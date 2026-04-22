/**
 * Returns a copy of process.env with server-specific variables removed.
 * Prevents PORT, AIW_PORT, etc. from leaking into spawned child processes.
 */

/** Env keys that are set by the server and should not be inherited by children. */
const SERVER_ENV_KEYS = ["PORT", "AIW_PORT"] as const;

export function getCleanEnv(
  extra?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const env = { ...process.env, ...extra };
  for (const key of SERVER_ENV_KEYS) {
    if (!(key in (extra ?? {}))) {
      delete env[key];
    }
  }
  return env;
}
