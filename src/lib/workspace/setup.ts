/**
 * Workspace setup — creating workspaces and parsing task analysis results.
 */

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getWorkspaceDir } from "../config";
import { buildReadmeContent } from "../templates";
import { exec, sanitizeSlug } from "./helpers";
import type { TaskAnalysis } from "@/types/workspace";
import type { SetupWorkspaceResult } from "@/types/operation";

// ---------------------------------------------------------------------------
// Task analysis — structured metadata extraction via Claude child process
// ---------------------------------------------------------------------------

/**
 * Parse a TaskAnalysis from structured JSON text (from --json-schema output).
 * Uses Bun.JSONL.parseChunk for non-throwing parse with error reporting.
 * Returns a fallback if the text is empty or unparseable.
 */
export function parseAnalysisResultText(jsonText: string | undefined, fallbackDescription: string): TaskAnalysis {
  const fallback: TaskAnalysis = {
    taskType: "feature",
    slug: sanitizeSlug(fallbackDescription),
    ticketId: "",
    repositories: [],
  };

  if (!jsonText) return fallback;

  const { values, error } = Bun.JSONL.parseChunk(jsonText);
  if (error || values.length === 0) return fallback;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = values[0] as Record<string, any>;
  return {
    taskType: parsed.taskType || fallback.taskType,
    slug: sanitizeSlug(parsed.slug || "") || fallback.slug,
    ticketId: parsed.ticketId || "",
    repositories: Array.isArray(parsed.repositories) ? parsed.repositories : [],
  };
}

const GITIGNORE_CONTENT = `# Exclude repository worktrees (they are separate git repos)
github.com/
gitlab.com/
bitbucket.org/

# Exclude temporary files
tmp/
*.tmp
*.log
`;

// ---------------------------------------------------------------------------
// setupWorkspace
// ---------------------------------------------------------------------------

export async function setupWorkspace(
  taskType: string,
  description: string,
  ticketId?: string,
  preGeneratedSlug?: string,
): Promise<SetupWorkspaceResult> {
  // Use pre-generated slug if provided, otherwise sanitize the description
  let slug = preGeneratedSlug
    ? sanitizeSlug(preGeneratedSlug)
    : sanitizeSlug(description);

  // Strip ticket ID from slug if already provided separately
  if (ticketId) {
    const tLower = ticketId.toLowerCase();
    slug = slug
      .replace(new RegExp(`^${tLower}-`), "")
      .replace(new RegExp(`-${tLower}-`, "g"), "-")
      .replace(new RegExp(`-${tLower}$`), "");
    if (slug === tLower) slug = "";
    slug = slug.replace(/^-+|-+$/g, "");
    if (!slug) slug = "workspace";
  }

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let dirName = ticketId
    ? `${taskType}-${ticketId}-${slug}-${date}`
    : `${taskType}-${slug}-${date}`;

  // If the directory already exists, append a numeric suffix
  let wsPath = path.join(getWorkspaceDir(), dirName);
  if (existsSync(wsPath)) {
    let suffix = 2;
    while (existsSync(path.join(getWorkspaceDir(), `${dirName}-${suffix}`))) {
      suffix++;
    }
    dirName = `${dirName}-${suffix}`;
    wsPath = path.join(getWorkspaceDir(), dirName);
  }

  // Create directories
  mkdirSync(wsPath, { recursive: true });
  mkdirSync(path.join(wsPath, "tmp"), { recursive: true });
  mkdirSync(path.join(wsPath, "artifacts"), { recursive: true });
  await Bun.write(path.join(wsPath, "artifacts", ".gitkeep"), "");

  // Initialize git
  exec(`git init --quiet "${wsPath}"`);

  // Write .gitignore
  await Bun.write(path.join(wsPath, ".gitignore"), GITIGNORE_CONTENT);

  // Write README
  const dateFormatted = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const readme = buildReadmeContent(description, taskType, ticketId ?? "N/A", dateFormatted);
  await Bun.write(path.join(wsPath, "README.md"), readme);

  // Initial commit
  exec(`git -C "${wsPath}" add .gitignore README.md artifacts/`);
  exec(`git -C "${wsPath}" commit --quiet -m "Initial: ${dirName} workspace created"`);

  return { workspaceName: dirName, workspacePath: wsPath };
}

