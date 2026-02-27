import { spawnClaudeSync } from "./cli";

/** Run `claude --version` and return the version string. */
export function getClaudeVersion(): string {
  const result = spawnClaudeSync({ args: ["--version"] });
  if (!result.success) {
    throw new Error(result.stderr.toString().trim() || "claude --version failed");
  }
  return result.stdout.toString().trim();
}
