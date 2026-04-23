/**
 * Returns a copy of process.env with server-specific variables removed.
 * Prevents PORT, AIW_PORT, etc. from leaking into spawned child processes.
 */

/** Exact env keys that should not be inherited by children. */
const SERVER_ENV_KEYS = [
  "PORT",
  "TURBOPACK",
  "NODE",
  "NODE_ENV",
  "NODE_OPTIONS",
  "AIW_PORT",
  "AIW_CHAT_PORT",
  "AIW_WORKSPACE_ROOT",
  "AIW_DISABLE_ACCESS_LOG",
] as const;

/** Key prefixes to strip (e.g. NEXT_*, npm_*). */
const SERVER_ENV_PREFIXES = ["NEXT_", "__NEXT_", "npm_"] as const;

export function getCleanEnv(
  extra?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const env = { ...process.env, ...extra };
  const extraKeys = extra ?? {};
  for (const key of SERVER_ENV_KEYS) {
    if (!(key in extraKeys)) {
      delete env[key];
    }
  }
  for (const key of Object.keys(env)) {
    if (key in extraKeys) continue;
    if (SERVER_ENV_PREFIXES.some((p) => key.startsWith(p))) {
      delete env[key];
    }
  }
  return env;
}
