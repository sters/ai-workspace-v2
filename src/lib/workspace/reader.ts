import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_DIR } from "../config";
import { parseTodoFile } from "../parsers/todo";
import { parseReadmeMeta } from "../parsers/readme";
import { parseReviewSummary } from "../parsers/review";
import type {
  WorkspaceSummary,
  WorkspaceDetail,
  TodoFile,
  ReviewSession,
  HistoryEntry,
} from "@/types/workspace";

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  if (!existsSync(WORKSPACE_DIR)) return [];

  const entries = readdirSync(WORKSPACE_DIR, { withFileTypes: true });
  const workspaces: WorkspaceSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsPath = path.join(WORKSPACE_DIR, entry.name);
    const readmePath = path.join(wsPath, "README.md");
    if (!existsSync(readmePath)) continue;

    try {
      const summary = await buildWorkspaceSummary(entry.name, wsPath);
      workspaces.push(summary);
    } catch {
      // skip broken workspaces
    }
  }

  // Sort by last modified (most recent first)
  workspaces.sort(
    (a, b) =>
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
  );

  return workspaces;
}

export async function getWorkspaceDetail(name: string): Promise<WorkspaceDetail | null> {
  const wsPath = path.join(WORKSPACE_DIR, name);
  if (!existsSync(wsPath)) return null;

  const summary = await buildWorkspaceSummary(name, wsPath);
  const readmeFile = Bun.file(path.join(wsPath, "README.md"));
  const readme = (await readmeFile.exists())
    ? await readmeFile.text()
    : "";

  const reviews = await listReviewSessions(wsPath);

  return { ...summary, readme, reviews };
}

async function buildWorkspaceSummary(
  name: string,
  wsPath: string
): Promise<WorkspaceSummary> {
  const readmeFile = Bun.file(path.join(wsPath, "README.md"));
  const readmeContent = (await readmeFile.exists())
    ? await readmeFile.text()
    : "";

  const meta = parseReadmeMeta(readmeContent);
  const todos = await listTodoFiles(wsPath);

  const totalCompleted = todos.reduce((s, t) => s + t.completed, 0);
  const totalItems = todos.reduce((s, t) => s + t.total, 0);
  const overallProgress =
    totalItems > 0 ? Math.round((totalCompleted * 100) / totalItems) : 0;

  const stat = statSync(wsPath);

  return {
    name,
    path: wsPath,
    meta,
    todos,
    overallProgress,
    totalCompleted,
    totalItems,
    lastModified: stat.mtime.toISOString(),
  };
}

async function listTodoFiles(wsPath: string): Promise<TodoFile[]> {
  const glob = new Bun.Glob("TODO-*.md");
  const files = [...glob.scanSync({ cwd: wsPath })];
  const results: TodoFile[] = [];
  for (const f of files) {
    const content = await Bun.file(path.join(wsPath, f)).text();
    results.push(parseTodoFile(f, content));
  }
  return results;
}

async function listReviewSessions(wsPath: string): Promise<ReviewSession[]> {
  const reviewsDir = path.join(wsPath, "artifacts", "reviews");
  if (!existsSync(reviewsDir)) return [];

  const entries = readdirSync(reviewsDir, { withFileTypes: true });
  const sessions: ReviewSession[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const summaryFile = Bun.file(path.join(reviewsDir, entry.name, "SUMMARY.md"));
    if (!(await summaryFile.exists())) continue;

    try {
      const content = await summaryFile.text();
      sessions.push(parseReviewSummary(entry.name, content));
    } catch {
      // skip
    }
  }

  sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return sessions;
}

export async function getReadme(name: string): Promise<string | null> {
  const file = Bun.file(path.join(WORKSPACE_DIR, name, "README.md"));
  return (await file.exists()) ? file.text() : null;
}

export async function getTodos(name: string): Promise<TodoFile[]> {
  const wsPath = path.join(WORKSPACE_DIR, name);
  if (!existsSync(wsPath)) return [];
  return listTodoFiles(wsPath);
}

export async function getReviewSessions(name: string): Promise<ReviewSession[]> {
  const wsPath = path.join(WORKSPACE_DIR, name);
  if (!existsSync(wsPath)) return [];
  return listReviewSessions(wsPath);
}

export async function getReviewDetail(
  name: string,
  timestamp: string
): Promise<{ summary: string; files: { name: string; content: string }[] } | null> {
  const reviewDir = path.join(
    WORKSPACE_DIR,
    name,
    "artifacts",
    "reviews",
    timestamp
  );
  if (!existsSync(reviewDir)) return null;

  const summaryFile = Bun.file(path.join(reviewDir, "SUMMARY.md"));
  const summary = (await summaryFile.exists())
    ? await summaryFile.text()
    : "";

  const glob = new Bun.Glob("*.md");
  const mdFiles = [...glob.scanSync({ cwd: reviewDir })].filter((f) => f !== "SUMMARY.md");
  const files: { name: string; content: string }[] = [];
  for (const f of mdFiles) {
    const content = await Bun.file(path.join(reviewDir, f)).text();
    files.push({ name: f, content });
  }

  return { summary, files };
}

export function getCommitDiff(name: string, hash: string): string | null {
  const wsPath = path.join(WORKSPACE_DIR, name);
  if (!existsSync(path.join(wsPath, ".git"))) return null;

  // Validate hash format to prevent injection
  if (!/^[0-9a-f]{4,40}$/i.test(hash)) return null;

  try {
    const result = Bun.spawnSync(
      ["git", "-C", wsPath, "show", hash, "--format=", "--patch"],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (!result.success) return null;
    return result.stdout.toString();
  } catch {
    return null;
  }
}

export function getHistory(name: string): HistoryEntry[] {
  const wsPath = path.join(WORKSPACE_DIR, name);
  if (!existsSync(path.join(wsPath, ".git"))) return [];

  try {
    const result = Bun.spawnSync(
      ["git", "-C", wsPath, "log", "--format=%H|%aI|%s|%an", "-30"],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (!result.success) return [];
    return result.stdout
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line: string) => {
        const [hash, date, message, author] = line.split("|");
        return { hash, date, message, author };
      });
  } catch {
    return [];
  }
}
