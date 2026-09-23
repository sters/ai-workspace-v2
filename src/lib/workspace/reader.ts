import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { getWorkspaceDir } from "../config";
import { getCleanEnv } from "../env";
import { getArchivedNameSet, isWorkspaceArchived } from "../db/archives";
import { parseTodoFile } from "../parsers/todo";
import { parseReadmeMeta } from "../parsers/readme";
import { parseReviewSummary } from "../parsers/review";
import type {
  WorkspaceSummary,
  WorkspaceListItem,
  TodoFile,
  ReviewSession,
  ReviewFileRef,
  HistoryEntry,
} from "@/types/workspace";
import type { QuickSearchResult } from "@/types/search";

const DEFAULT_DISPLAY_LIMIT = 20;

export async function listWorkspaces(
  options?: { recentOnly?: boolean },
): Promise<{ workspaces: WorkspaceSummary[]; olderCount: number; archivedCount: number }> {
  if (!existsSync(getWorkspaceDir()))
    return { workspaces: [], olderCount: 0, archivedCount: 0 };

  const entries = readdirSync(getWorkspaceDir(), { withFileTypes: true });
  const archived = getArchivedNameSet();
  const candidates: { name: string; wsPath: string; mtime: number }[] = [];
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

    const mtime = statSync(wsPath).mtime.getTime();
    candidates.push({ name: entry.name, wsPath, mtime });
  }

  // Sort by mtime desc (most recent first)
  candidates.sort((a, b) => b.mtime - a.mtime);

  // When recentOnly, limit to first N items to skip expensive summary builds
  let olderCount = 0;
  let selected = candidates;
  if (options?.recentOnly && candidates.length > DEFAULT_DISPLAY_LIMIT) {
    selected = candidates.slice(0, DEFAULT_DISPLAY_LIMIT);
    olderCount = candidates.length - DEFAULT_DISPLAY_LIMIT;
  }

  const workspaces: WorkspaceSummary[] = [];
  for (const c of selected) {
    try {
      const summary = await buildWorkspaceSummary(c.name, c.wsPath);
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
  const archived = getArchivedNameSet();
  const includeArchived = options?.includeArchived ?? false;
  const candidates: { name: string; wsPath: string; mtime: number }[] = [];
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

    const mtime = statSync(wsPath).mtime.getTime();
    candidates.push({ name: entry.name, wsPath, mtime });
  }

  // Sort by mtime desc (most recent first)
  candidates.sort((a, b) => b.mtime - a.mtime);

  // When recentOnly, limit to first N items
  let olderCount = 0;
  let selected = candidates;
  if (options?.recentOnly && candidates.length > DEFAULT_DISPLAY_LIMIT) {
    selected = candidates.slice(0, DEFAULT_DISPLAY_LIMIT);
    olderCount = candidates.length - DEFAULT_DISPLAY_LIMIT;
  }

  const workspaces: WorkspaceListItem[] = [];
  for (const c of selected) {
    try {
      const item = await buildWorkspaceListItem(c.name, c.wsPath);
      if (archived.has(c.name)) item.archived = true;
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

  const summary = await buildWorkspaceSummary(name, wsPath);
  // Only this path needs it: `listWorkspaces` drops archived workspaces before
  // building their summaries.
  summary.archived = isWorkspaceArchived(name);
  return summary;
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

function reviewDirPath(name: string, timestamp: string): string {
  return path.join(getWorkspaceDir(), name, "artifacts", "reviews", timestamp);
}

async function readReviewSummary(reviewDir: string): Promise<string> {
  const summaryFile = Bun.file(path.join(reviewDir, "SUMMARY.md"));
  return (await summaryFile.exists()) ? await summaryFile.text() : "";
}

function reviewReportNames(reviewDir: string): string[] {
  const glob = new Bun.Glob("*.md");
  return [...glob.scanSync({ cwd: reviewDir })]
    .filter((f) => f !== "SUMMARY.md")
    .sort();
}

/**
 * A review session's summary plus the names of its per-repo reports.
 *
 * The reports are named, not read: a cycle writes one `REVIEW-*`, `VERIFY-*`
 * and `CONSTRAINTS-*` per repository, so a multi-repo session's contents run to
 * hundreds of kilobytes that the tab renders collapsed. The UI reads a report
 * through the artifacts file route when it is opened.
 */
export async function getReviewFileList(
  name: string,
  timestamp: string
): Promise<{ summary: string; files: ReviewFileRef[] } | null> {
  const reviewDir = reviewDirPath(name, timestamp);
  if (!existsSync(reviewDir)) return null;

  const summary = await readReviewSummary(reviewDir);
  const files: ReviewFileRef[] = [];
  for (const f of reviewReportNames(reviewDir)) {
    try {
      files.push({ name: f, size: statSync(path.join(reviewDir, f)).size });
    } catch {
      // Gone between the scan and the stat: a running review rewrites this directory.
    }
  }

  return { summary, files };
}

/** The same session with every report's content, for the phases that embed them in a prompt. */
export async function getReviewDetail(
  name: string,
  timestamp: string
): Promise<{ summary: string; files: { name: string; content: string }[] } | null> {
  const reviewDir = reviewDirPath(name, timestamp);
  if (!existsSync(reviewDir)) return null;

  const summary = await readReviewSummary(reviewDir);
  const files: { name: string; content: string }[] = [];
  for (const f of reviewReportNames(reviewDir)) {
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
      { stdout: "pipe", stderr: "pipe", env: getCleanEnv() }
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

const HISTORY_PAGE_SIZE = 30;

export function getHistory(name: string, skip = 0): { entries: HistoryEntry[]; hasMore: boolean } {
  const wsPath = path.join(getWorkspaceDir(), name);
  if (!existsSync(path.join(wsPath, ".git"))) return { entries: [], hasMore: false };

  try {
    // Fetch one extra to detect if there are more commits beyond this page
    const args = ["git", "-C", wsPath, "log", "--format=%H|%aI|%s|%an", `-${HISTORY_PAGE_SIZE + 1}`];
    if (skip > 0) args.push(`--skip=${skip}`);
    const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe", env: getCleanEnv() });
    if (!result.success) return { entries: [], hasMore: false };
    const all = result.stdout
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line: string) => {
        const [hash, date, message, author] = line.split("|");
        return { hash, date, message, author };
      });
    const hasMore = all.length > HISTORY_PAGE_SIZE;
    return { entries: all.slice(0, HISTORY_PAGE_SIZE), hasMore };
  } catch {
    return { entries: [], hasMore: false };
  }
}
