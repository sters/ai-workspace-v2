import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

/** Base directory for all per-workspace config/data directories. */
export const CONFIG_BASE_DIR = path.join(os.homedir(), ".config", "ai-workspace");

/**
 * Compute the per-workspace config directory for a given workspace root.
 * Format: `~/.config/ai-workspace/{basename}-{sha256_8}/`
 */
export function getWorkspaceConfigDir(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot);
  const basename = path.basename(resolved);
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 8);
  return path.join(CONFIG_BASE_DIR, `${basename}-${hash}`);
}

/** Get the per-workspace SQLite database path. */
export function getWorkspaceDbPath(workspaceRoot: string): string {
  return path.join(getWorkspaceConfigDir(workspaceRoot), "db.sqlite");
}

/** Get the per-workspace config file path. */
export function getWorkspaceConfigFilePath(workspaceRoot: string): string {
  return path.join(getWorkspaceConfigDir(workspaceRoot), "config.yml");
}
