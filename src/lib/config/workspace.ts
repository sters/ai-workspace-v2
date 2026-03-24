import path from "node:path";
import { getResolvedWorkspaceRoot } from "./resolver";

/** Get the workspace directory (reads config/env at call time). */
export function getWorkspaceDir(): string {
  return path.join(getResolvedWorkspaceRoot(), "workspace");
}

export function resolveWorkspaceName(input: string): string {
  return path.basename(input);
}

/**
 * Resolve an input path to an absolute path within the workspace root.
 * Accepts both absolute paths (already under workspace root) and bare
 * workspace names. Returns `null` if the resolved path escapes the root.
 */
export function resolveWorkspacePath(input: string): string | null {
  const root = getResolvedWorkspaceRoot();
  const resolved = path.isAbsolute(input)
    ? path.resolve(input)
    : path.resolve(getWorkspaceDir(), input);
  // Ensure the path is within the workspace root (prevent traversal)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}
