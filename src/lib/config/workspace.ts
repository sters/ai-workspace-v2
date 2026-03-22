import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./resolver";

function resolveRoot(): string {
  if (process.env.AIW_WORKSPACE_ROOT) {
    const root = process.env.AIW_WORKSPACE_ROOT;
    if (!fs.existsSync(root)) {
      console.warn(`[config] AIW_WORKSPACE_ROOT="${root}" does not exist`);
    }
    return root;
  }
  // Check config file for workspaceRoot
  const configRoot = getConfig().workspaceRoot;
  if (configRoot) {
    if (!fs.existsSync(configRoot)) {
      console.warn(`[config] config.yml workspaceRoot="${configRoot}" does not exist`);
    }
    return configRoot;
  }
  // Default: assume webui/ is inside the ai-workspace root
  const fallback = path.resolve(process.cwd(), "..");
  if (!fs.existsSync(path.join(fallback, "workspace"))) {
    console.warn(
      `[config] No AIW_WORKSPACE_ROOT set and no workspace/ found at "${fallback}". ` +
      `Set AIW_WORKSPACE_ROOT or workspaceRoot in config.yml.`,
    );
  }
  return fallback;
}

/** Get the ai-workspace root directory (reads config/env at call time). */
export function getAiWorkspaceRoot(): string {
  return resolveRoot();
}

/** Get the workspace directory (reads config/env at call time). */
export function getWorkspaceDir(): string {
  return path.join(resolveRoot(), "workspace");
}

/**
 * @deprecated Use `getAiWorkspaceRoot()` instead. This constant is evaluated
 * once at module load time and may become stale if config/env changes.
 */
export const AI_WORKSPACE_ROOT = resolveRoot();

/**
 * @deprecated Use `getWorkspaceDir()` instead. This constant is evaluated
 * once at module load time and may become stale if config/env changes.
 */
export const WORKSPACE_DIR = path.join(AI_WORKSPACE_ROOT, "workspace");

export function resolveWorkspaceName(input: string): string {
  return path.basename(input);
}
