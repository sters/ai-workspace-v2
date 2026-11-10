/**
 * The PR watcher: reads the PR on every worktree branch of each unarchived
 * workspace and records what changed as `pr_events`. It only observes; nothing
 * here acts on an event. Which PRs are read on a given tick is decided by
 * `scheduler.ts`.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { getArchivedNameSet } from "@/lib/db/archives";
import { getPrSnapshot, savePrObservation } from "@/lib/db/pr-watch";
import { pathExists } from "@/lib/fs";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { runGit } from "@/lib/workspace/git-exec";
import { execArgs } from "@/lib/workspace/helpers";
import { readRepoPullRequest } from "@/lib/workspace/pr-threads";
import type { WorkspacePullRequest } from "@/types/pull-request";
import type { WorkspaceRepo } from "@/types/workspace";
import { observePr } from "./observe";
import type { Notification, WatchTarget } from "./scheduler";

const TERMINAL_STATES = new Set(["MERGED", "CLOSED"]);

export async function listUnarchivedWorkspaceNames(): Promise<string[]> {
  const dir = getWorkspaceDir();
  if (!(await pathExists(dir))) return [];
  const archived = getArchivedNameSet();
  const names: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || archived.has(entry.name)) continue;
    if (await pathExists(path.join(dir, entry.name, "README.md"))) names.push(entry.name);
  }
  return names;
}

export async function listWatchTargets(): Promise<WatchTarget[]> {
  const targets: WatchTarget[] = [];
  for (const workspace of await listUnarchivedWorkspaceNames()) {
    for (const repo of await listWorkspaceRepos(workspace)) targets.push({ workspace, repo });
  }
  return targets;
}

/**
 * Read one worktree's PR and record what changed. `pr` is the PR when it is
 * open and was read in full, else null (no PR, merged or closed, or a partial read).
 */
export async function observeRepoPr(
  workspace: string,
  repo: WorkspaceRepo,
  read: typeof readRepoPullRequest = readRepoPullRequest,
): Promise<{ pr: WorkspacePullRequest | null; events: number }> {
  const prev = getPrSnapshot(workspace, repo.repoName);
  if (prev && TERMINAL_STATES.has(prev.state)) return { pr: null, events: 0 };

  const result = await read(repo);
  // A PR read without its threads and CI would look like every check vanished.
  if (!result.pr || result.problem) return { pr: null, events: 0 };

  const { events, snapshot } = observePr(prev, result.pr, workspace, new Date().toISOString());
  savePrObservation(snapshot, events);
  return { pr: TERMINAL_STATES.has(result.pr.state) ? null : result.pr, events: events.length };
}

/**
 * Notification threads on PRs and CI runs updated since `sinceIso`, read or
 * not, so reading one in the browser first does not hide it. Only the `gh`
 * default host is covered.
 */
export async function readNotifications(sinceIso: string): Promise<Notification[]> {
  const raw = await execArgs([
    "gh", "api", "--paginate",
    "--jq", '.[] | [.repository.full_name, .subject.type, (.subject.url // "")] | @tsv',
    `/notifications?all=true&per_page=50&since=${encodeURIComponent(sinceIso)}`,
  ]);
  const out: Notification[] = [];
  for (const line of raw.split("\n")) {
    const [repo, type, url] = line.split("\t");
    if (!repo) continue;
    if (type === "PullRequest") {
      const n = /\/pulls\/(\d+)$/.exec(url ?? "");
      if (n) out.push({ repo, pr: Number(n[1]) });
    } else if (type === "CheckSuite") {
      out.push({ repo, pr: null });
    }
  }
  return out;
}

/** The remote head of `base`, over git rather than the API, so it costs no rate limit. */
export async function readBaseSha(worktreePath: string, base: string): Promise<string | null> {
  const r = await runGit(["ls-remote", "origin", `refs/heads/${base}`], worktreePath);
  return r.ok ? r.out.split(/\s/)[0] || null : null;
}
