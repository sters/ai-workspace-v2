/**
 * Workspace templates — I/O wrappers for writing template files to disk.
 * Template content is defined in @/lib/templates.
 */

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getWorkspaceDir } from "../config";
import { selectTodoTemplate, REPORT_TEMPLATES, RESEARCH_REPORT_TEMPLATES } from "../templates";

/** Ensure the templates/ subdirectory exists and return its path. */
function ensureTemplatesDir(wsPath: string): string {
  const dir = path.join(wsPath, "templates");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write the appropriate TODO template to {wsPath}/templates/TODO-template.md
 * based on the task type.
 */
export async function writeTodoTemplate(wsPath: string, taskType: string): Promise<void> {
  const dir = ensureTemplatesDir(wsPath);
  const template = selectTodoTemplate(taskType);
  await Bun.write(path.join(dir, "TODO-template.md"), template);
}

/**
 * Write all report templates to the workspace templates/ directory.
 * These are used by review, verification, research, and summary agents.
 */
export async function writeReportTemplates(wsPath: string): Promise<void> {
  const dir = ensureTemplatesDir(wsPath);
  await Promise.all(
    Object.entries(REPORT_TEMPLATES).map(([filename, content]) =>
      Bun.write(path.join(dir, filename), content),
    ),
  );
}

/**
 * Write research report templates to the workspace templates/ directory.
 * Also ensures the artifacts/research/ output directory exists.
 */
export async function writeResearchTemplates(wsPath: string): Promise<string> {
  const dir = ensureTemplatesDir(wsPath);
  const researchDir = path.join(wsPath, "artifacts", "research");
  mkdirSync(researchDir, { recursive: true });
  await Promise.all(
    Object.entries(RESEARCH_REPORT_TEMPLATES).map(([filename, content]) =>
      Bun.write(path.join(dir, `research-${filename}`), content),
    ),
  );
  return researchDir;
}

// ---------------------------------------------------------------------------
// prepareReviewDir
// ---------------------------------------------------------------------------

export function prepareReviewDir(workspaceName: string): string {
  const wsPath = path.join(getWorkspaceDir(), workspaceName);
  if (!existsSync(wsPath)) {
    throw new Error(`Workspace directory not found: ${wsPath}`);
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");

  const reviewDir = path.join(wsPath, "artifacts", "reviews", timestamp);
  mkdirSync(reviewDir, { recursive: true });
  return timestamp;
}
