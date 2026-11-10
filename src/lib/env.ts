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
] as const;

/**
 * Key prefixes to strip (e.g. NEXT_*, npm_*). `AIW_` covers the server's own
 * settings, secrets such as the Slack tokens among them: agents run in these
 * children and can read their environment.
 */
const SERVER_ENV_PREFIXES = ["NEXT_", "__NEXT_", "npm_", "AIW_"] as const;

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
