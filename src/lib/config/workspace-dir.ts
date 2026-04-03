import path from "node:path";

/**
 * Compute the per-workspace config directory for a given workspace root.
 * Format: `{workspaceRoot}/.ai-workspace/`
 */
export function getWorkspaceConfigDir(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot);
  return path.join(resolved, ".ai-workspace");
}

/** Get the per-workspace SQLite database path. */
export function getWorkspaceDbPath(workspaceRoot: string): string {
  return path.join(getWorkspaceConfigDir(workspaceRoot), "db.sqlite");
}

/** Get the per-workspace config file path. */
export function getWorkspaceConfigFilePath(workspaceRoot: string): string {
  return path.join(getWorkspaceConfigDir(workspaceRoot), "config.yml");
}
