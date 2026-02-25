import { cliPath } from "./claude-sdk";
import { AI_WORKSPACE_ROOT } from "./config";

export function spawnVersion() {
  return Bun.spawn([cliPath, "--version"], {
    cwd: AI_WORKSPACE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
}
