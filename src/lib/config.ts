import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./app-config";

function resolveRoot(): string {
  if (process.env.AI_WORKSPACE_ROOT) {
    const root = process.env.AI_WORKSPACE_ROOT;
    if (!fs.existsSync(root)) {
      console.warn(`[config] AI_WORKSPACE_ROOT="${root}" does not exist`);
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
      `[config] No AI_WORKSPACE_ROOT set and no workspace/ found at "${fallback}". ` +
      `Set AI_WORKSPACE_ROOT to the ai-workspace root directory.`,
    );
  }
  return fallback;
}

export const AI_WORKSPACE_ROOT = resolveRoot();
export const WORKSPACE_DIR = path.join(AI_WORKSPACE_ROOT, "workspace");

export function resolveWorkspaceName(input: string): string {
  return path.basename(input);
}
