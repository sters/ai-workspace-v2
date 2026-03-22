import path from "node:path";
import { getResolvedWorkspaceRoot } from "./resolver";

/** Get the workspace directory (reads config/env at call time). */
export function getWorkspaceDir(): string {
  return path.join(getResolvedWorkspaceRoot(), "workspace");
}

export function resolveWorkspaceName(input: string): string {
  return path.basename(input);
}
