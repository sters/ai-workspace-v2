import { runClaudeCommand } from "./cli";

/** Run `claude --version` and return the version string. */
export async function getClaudeVersion(): Promise<string> {
  const result = await runClaudeCommand({ args: ["--version"] });
  if (!result.success) {
    throw new Error(result.stderr.trim() || "claude --version failed");
  }
  return result.stdout.trim();
}
