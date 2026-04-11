import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { getWorkspaceDir } from "../config";
import { getArchivedNameSet } from "../db/archives";
import { parseTodoFile } from "../parsers/todo";
import { parseReadmeMeta } from "../parsers/readme";
import { parseReviewSummary } from "../parsers/review";
import type {
  WorkspaceSummary,
  WorkspaceListItem,
  TodoFile,
  ReviewSession,
  HistoryEntry,
} from "@/types/workspace";
import type { QuickSearchResult } from "@/types/search";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function listWorkspaces(
  options?: { recentOnly?: boolean },
): Promise<{ workspaces: WorkspaceSummary[]; olderCount: number; archivedCount: number }> {
  if (!existsSync(getWorkspaceDir()))
    return { workspaces: [], olderCount: 0, archivedCount: 0 };

  const entries = readdirSync(getWorkspaceDir(), { withFileTypes: true });
  const cutoff = options?.recentOnly ? Date.now() - ONE_WEEK_MS : 0;
  const archived = getArchivedNameSet();
  const workspaces: WorkspaceSummary[] = [];
  let olderCount = 0;
  let archivedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsPath = path.join(getWorkspaceDir(), entry.name);
    const readmePath = path.join(wsPath, "README.md");
    if (!existsSync(readmePath)) continue;

    if (archived.has(entry.name)) {
      archivedCount++;
      continue;
    }

    // When recentOnly, skip expensive summary build for old workspaces
    if (cutoff > 0) {
      const mtime = statSync(wsPath).mtime.getTime();
      if (mtime < cutoff) {
        olderCount++;
        continue;
      }
    }

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

  return { workspaces, olderCount, archivedCount };
}

/** Lightweight list for dashboard cards — skips full TODO parsing. */
export async function listWorkspaceItems(
  options?: { recentOnly?: boolean; includeArchived?: boolean },
): Promise<{ workspaces: WorkspaceListItem[]; olderCount: number; archivedCount: number }> {
  if (!existsSync(getWorkspaceDir()))
    return { workspaces: [], olderCount: 0, archivedCount: 0 };

  const entries = readdirSync(getWorkspaceDir(), { withFileTypes: true });
  const cutoff = options?.recentOnly ? Date.now() - ONE_WEEK_MS : 0;
  const archived = getArchivedNameSet();
  const includeArchived = options?.includeArchived ?? false;
  const workspaces: WorkspaceListItem[] = [];
  let olderCount = 0;
  let archivedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsPath = path.join(getWorkspaceDir(), entry.name);
    const readmePath = path.join(wsPath, "README.md");
    if (!existsSync(readmePath)) continue;

    const isArch = archived.has(entry.name);
    if (isArch && !includeArchived) {
      archivedCount++;
      continue;
    }

    if (!isArch && cutoff > 0) {
      const mtime = statSync(wsPath).mtime.getTime();
      if (mtime < cutoff) {
        olderCount++;
        continue;
      }
    }

    try {
      const item = await buildWorkspaceListItem(entry.name, wsPath);
      if (isArch) item.archived = true;
      workspaces.push(item);
    } catch {
      // skip broken workspaces
    }
  }

  workspaces.sort(
    (a, b) =>
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
  );

  return { workspaces, olderCount, archivedCount };
}

export async function getWorkspaceSummary(name: string): Promise<WorkspaceSummary | null> {
  const wsPath = path.join(getWorkspaceDir(), name);
  if (!existsSync(wsPath)) return null;

  return buildWorkspaceSummary(name, wsPath);
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
    totalItems > 0 ? Math.round((totalCompleted * 100) / totalItems) : 100;

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

async function buildWorkspaceListItem(
  name: string,
  wsPath: string,
): Promise<WorkspaceListItem> {
  const readmeFile = Bun.file(path.join(wsPath, "README.md"));
  const readmeContent = (await readmeFile.exists())
    ? await readmeFile.text()
    : "";

  const meta = parseReadmeMeta(readmeContent);

  // Count TODO progress without full parse
  const { completed, total } = await countTodoProgress(wsPath);
  const overallProgress =
    total > 0 ? Math.round((completed * 100) / total) : 100;
  const stat = statSync(wsPath);

  return {
    name,
    title: meta.title,
    taskType: meta.taskType,
    ticketId: meta.ticketId,
    date: meta.date,
    repoCount: meta.repositories.length,
    overallProgress,
    totalCompleted: completed,
    totalItems: total,
    lastModified: stat.mtime.toISOString(),
  };
}

const TODO_CHECKBOX_RE = /^[ \t]*- \[(.)\]/gm;

async function countTodoProgress(wsPath: string): Promise<{ completed: number; total: number }> {
  const glob = new Bun.Glob("TODO-*.md");
  const files = [...glob.scanSync({ cwd: wsPath })].filter(
    (f) => f !== "TODO-template.md",
  );
  let completed = 0;
  let total = 0;
  for (const f of files) {
    const content = await Bun.file(path.join(wsPath, f)).text();
    let match;
    TODO_CHECKBOX_RE.lastIndex = 0;
    while ((match = TODO_CHECKBOX_RE.exec(content)) !== null) {
      total++;
      if (match[1] === "x" || match[1] === "X") completed++;
    }
  }
  return { completed, total };
}

async function listTodoFiles(wsPath: string): Promise<TodoFile[]> {
  const glob = new Bun.Glob("TODO-*.md");
  const files = [...glob.scanSync({ cwd: wsPath })].filter(
    (f) => f !== "TODO-template.md",
  );
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

export async function getResearchReport(
  name: string
): Promise<{ summary: string; files: { name: string; content: string }[] } | null> {
  const researchDir = path.join(getWorkspaceDir(), name, "artifacts", "research");

  if (existsSync(researchDir)) {
    const summaryFile = Bun.file(path.join(researchDir, "summary.md"));
    const summary = (await summaryFile.exists()) ? await summaryFile.text() : "";

    const glob = new Bun.Glob("*.md");
    const mdFiles = [...glob.scanSync({ cwd: researchDir })].filter((f) => f !== "summary.md").sort();
    const files: { name: string; content: string }[] = [];
    for (const f of mdFiles) {
      const content = await Bun.file(path.join(researchDir, f)).text();
      files.push({ name: f, content });
    }

    return { summary, files };
  }

  // Backward compat: single-file format
  const legacyFile = Bun.file(path.join(getWorkspaceDir(), name, "artifacts", "research-report.md"));
  if (await legacyFile.exists()) {
    return { summary: await legacyFile.text(), files: [] };
  }

  return null;
}

export async function getReadme(name: string): Promise<string | null> {
  const file = Bun.file(path.join(getWorkspaceDir(), name, "README.md"));
  return (await file.exists()) ? file.text() : null;
}

export async function getTodos(name: string): Promise<TodoFile[]> {
  const wsPath = path.join(getWorkspaceDir(), name);
  if (!existsSync(wsPath)) return [];
  return listTodoFiles(wsPath);
}

export async function getReviewSessions(name: string): Promise<ReviewSession[]> {
  const wsPath = path.join(getWorkspaceDir(), name);
  if (!existsSync(wsPath)) return [];
  return listReviewSessions(wsPath);
}

export async function getReviewDetail(
  name: string,
  timestamp: string
): Promise<{ summary: string; files: { name: string; content: string }[] } | null> {
  const reviewDir = path.join(
    getWorkspaceDir(),
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
  const wsPath = path.join(getWorkspaceDir(), name);
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

export async function quickSearchWorkspaces(query: string): Promise<QuickSearchResult[]> {
  if (!existsSync(getWorkspaceDir())) return [];

  const entries = readdirSync(getWorkspaceDir(), { withFileTypes: true });
  const archived = getArchivedNameSet();
  const results: QuickSearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const readmePath = path.join(getWorkspaceDir(), entry.name, "README.md");
    if (!existsSync(readmePath)) continue;

    try {
      const content = await Bun.file(readmePath).text();
      const lines = content.split("\n");
      const matches: { lineNumber: number; line: string }[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          matches.push({ lineNumber: i + 1, line: lines[i] });
        }
      }

      if (matches.length > 0) {
        const meta = parseReadmeMeta(content);
        const wsPath = path.join(getWorkspaceDir(), entry.name);
        const stat = statSync(wsPath);
        const result: QuickSearchResult = {
          workspaceName: entry.name,
          title: meta.title || entry.name,
          lastModified: stat.mtime.toISOString(),
          matches,
        };
        if (archived.has(entry.name)) result.archived = true;
        results.push(result);
      }
    } catch {
      // skip unreadable files
    }
  }

  // Sort by last modified (most recent first), same as listWorkspaces()
  results.sort(
    (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
  );

  return results;
}

export function getHistory(name: string): HistoryEntry[] {
  const wsPath = path.join(getWorkspaceDir(), name);
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
