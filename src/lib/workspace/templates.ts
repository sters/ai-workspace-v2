/**
 * Workspace templates — I/O wrappers for writing template files to disk.
 * Template content is defined in @/lib/templates.
 */

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_DIR } from "../config";
import { selectTodoTemplate, REPORT_TEMPLATES } from "../templates";

/**
 * Write the appropriate TODO template to {wsPath}/TODO-template.md
 * based on the task type.
 */
export async function writeTodoTemplate(wsPath: string, taskType: string): Promise<void> {
  const template = selectTodoTemplate(taskType);
  await Bun.write(path.join(wsPath, "TODO-template.md"), template);
}

/**
 * Write all report templates to the workspace directory.
 * These are used by review, verification, research, and summary agents.
 */
export async function writeReportTemplates(wsPath: string): Promise<void> {
  await Promise.all(
    Object.entries(REPORT_TEMPLATES).map(([filename, content]) =>
      Bun.write(path.join(wsPath, filename), content),
    ),
  );
}

// ---------------------------------------------------------------------------
// prepareReviewDir
// ---------------------------------------------------------------------------

export function prepareReviewDir(workspaceName: string): string {
  const wsPath = path.join(WORKSPACE_DIR, workspaceName);
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
