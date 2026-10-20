/**
 * The web form's quick creates, tracked in memory while they run. The form may
 * be closed and reopened while a create waits on git, and what it shows then —
 * the progress, a disabled button, where the result went — has to come from
 * here rather than from a request it no longer holds.
 */

import type { QuickCreateProgress, QuickCreateStart } from "@/types/workspace";

/** Long enough for a form reopened a little after the create ended to report it. */
const RETAIN_FINISHED_MS = 10 * 60 * 1000;
/** A setup emits a handful of lines per repository; the form shows the tail. */
const MAX_LOG_LINES = 200;

const globalStore = globalThis as unknown as {
  __aiwQuickCreates?: Map<string, QuickCreateProgress>;
};
if (!globalStore.__aiwQuickCreates) {
  globalStore.__aiwQuickCreates = new Map();
}
const quickCreates = globalStore.__aiwQuickCreates;

export function beginQuickCreate(name: string, now = Date.now()): string {
  const id = crypto.randomUUID();
  quickCreates.set(id, { id, name, startedAt: now, state: "running", log: [] });
  return id;
}

export function reportQuickCreate(id: string, message: string): void {
  const entry = quickCreates.get(id);
  if (!entry) return;
  entry.log.push(message);
  if (entry.log.length > MAX_LOG_LINES) entry.log.splice(0, entry.log.length - MAX_LOG_LINES);
}

export function reportQuickCreateWorkspace(id: string, workspace: string): void {
  const entry = quickCreates.get(id);
  if (entry) entry.workspace = workspace;
}

export type QuickCreateOutcome =
  | { workspace: string; start: QuickCreateStart; problems: number }
  | { error: string };

export function finishQuickCreate(id: string, outcome: QuickCreateOutcome, now = Date.now()): void {
  const entry = quickCreates.get(id);
  if (!entry) return;
  entry.finishedAt = now;
  if ("error" in outcome) {
    entry.state = "failed";
    entry.error = outcome.error;
  } else {
    entry.state = "done";
    entry.workspace = outcome.workspace;
    entry.start = outcome.start;
    entry.problems = outcome.problems;
  }
}

/** For a create the server refused: nothing was made, so there is nothing to report. */
export function discardQuickCreate(id: string): void {
  quickCreates.delete(id);
}

/** Newest first. A running create is never dropped, however long git takes. */
export function listQuickCreates(now = Date.now()): QuickCreateProgress[] {
  for (const [id, entry] of quickCreates) {
    if (entry.finishedAt != null && now - entry.finishedAt > RETAIN_FINISHED_MS) quickCreates.delete(id);
  }
  return [...quickCreates.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Whether a running create is still building `workspace`. Deleting it then
 * would not stop the create: its next worktree recreates the directory, and
 * leaves worktrees and branches under a workspace with no README.
 */
export function isQuickCreateBuilding(workspace: string): boolean {
  for (const entry of quickCreates.values()) {
    if (entry.state === "running" && entry.workspace === workspace) return true;
  }
  return false;
}

export function _resetQuickCreates(): void {
  quickCreates.clear();
}
