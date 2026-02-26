import { getCliPath } from "./cli-path";
import { AI_WORKSPACE_ROOT } from "../config";

export function spawnVersion() {
  return Bun.spawn([getCliPath(), "--version"], {
    cwd: AI_WORKSPACE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
}
