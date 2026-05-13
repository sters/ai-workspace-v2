/**
 * Substitute `{ENV:VAR_NAME}` placeholders inside string values with the
 * corresponding `process.env.VAR_NAME`. Walks objects and arrays recursively;
 * non-string scalars pass through. Missing env vars become empty strings and
 * trigger a console.warn so misconfigured secrets surface at startup.
 *
 * Variable names: uppercase ASCII letters / digits / underscores, must not start with a digit.
 */
const ENV_PLACEHOLDER = /\{ENV:([A-Z_][A-Z0-9_]*)\}/g;

export function substituteEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_PLACEHOLDER, (_, name: string) => {
      const v = process.env[name];
      if (v === undefined) {
        console.warn(
          `[app-config] {ENV:${name}} referenced but environment variable is not set; substituting empty string`,
        );
        return "";
      }
      return v;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteEnvVars(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteEnvVars(v);
    }
    return out;
  }
  return value;
}
