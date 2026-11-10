/**
 * Decides which workspace PRs to read on each tick, so a change is seen within
 * a minute or two without reading every PR every minute.
 *
 * A PR is read when one of these says it may have changed:
 * - a GitHub notification names it (comments, reviews, merge / close), or names
 *   its repository with no PR (an Actions run the user triggered finished);
 * - its base branch moved, the only way a conflict appears;
 * - its CI was pending or its mergeability still being computed at the last
 *   read: re-read after 1, 2, 4, then every 8 minutes until it settles;
 * - the periodic sweep, which reads everything and catches what the others miss
 *   (CI outside Actions that finished without a pending read, PRs on a host the
 *   notifications API does not cover).
 *
 * The schedule lives in memory: a restart begins with a sweep.
 */

import { ciState } from "./observe";
import { observeRepoPr } from "./index";
import type { RepoPullRequestRead } from "@/types/pull-request";
import type { WorkspaceRepo } from "@/types/workspace";

export interface WatchTarget {
  workspace: string;
  repo: WorkspaceRepo;
}

/** A notification thread: `repo` is `owner/name`; `pr` is null for one that names no PR (a CI run). */
export interface Notification {
  repo: string;
  pr: number | null;
}

export interface SchedulerDeps {
  listTargets: () => Promise<WatchTarget[]>;
  read: (repo: WorkspaceRepo) => Promise<RepoPullRequestRead>;
  /** Notifications updated since the ISO time. */
  notified: (sinceIso: string) => Promise<Notification[]>;
  baseSha: (worktreePath: string, base: string) => Promise<string | null>;
}

const BACKOFF_MINUTES = [1, 2, 4, 8];

interface OpenPr {
  repo: string;
  number: number;
  base: string;
  worktreePath: string;
  headSha: string;
}

function warnEmpty(err: unknown): Notification[] {
  console.warn(`[pr-watcher] notifications: ${err instanceof Error ? err.message : String(err)}`);
  return [];
}

const keyOf = (t: WatchTarget) => `${t.workspace}\0${t.repo.repoName}`;

/** `owner/name` from a repo path such as `github.com/acme/widgets`. */
function repoFromPath(repoPath: string): string | null {
  const parts = repoPath.split("/");
  return parts.length >= 3 ? parts.slice(-2).join("/").toLowerCase() : null;
}

export function createWatchScheduler(deps: SchedulerDeps, sweepMs: number) {
  let lastSweep = -Infinity;
  let since: string | null = null;
  const open = new Map<string, OpenPr>();
  const backoff = new Map<string, { step: number; at: number; headSha: string }>();
  const baseShas = new Map<string, string>();

  async function dueBySignal(targets: WatchTarget[], now: number, sinceIso: string | null): Promise<Set<string>> {
    const due = new Set<string>();
    const notes = sinceIso ? await deps.notified(sinceIso).catch(warnEmpty) : [];
    const norm = notes.map((n) => ({ repo: n.repo.toLowerCase(), pr: n.pr }));

    for (const t of targets) {
      const key = keyOf(t);
      const known = open.get(key);
      const hit = known
        ? norm.some((n) => n.repo === known.repo && (n.pr === null || n.pr === known.number))
        : norm.some((n) => n.pr !== null && n.repo === repoFromPath(t.repo.repoPath));
      if (hit) due.add(key);
      const b = backoff.get(key);
      if (b && b.at <= now) due.add(key);
    }

    const byBase = new Map<string, string[]>();
    for (const [key, p] of open) {
      const baseKey = `${p.repo}\0${p.base}`;
      byBase.set(baseKey, [...(byBase.get(baseKey) ?? []), key]);
    }
    for (const [baseKey, keys] of byBase) {
      const p = open.get(keys[0])!;
      const sha = await deps.baseSha(p.worktreePath, p.base).catch(() => null);
      if (!sha) continue;
      const prev = baseShas.get(baseKey);
      baseShas.set(baseKey, sha);
      if (prev && prev !== sha) for (const k of keys) due.add(k);
    }
    return due;
  }

  async function check(t: WatchTarget, now: number): Promise<number> {
    const key = keyOf(t);
    const { pr, events } = await observeRepoPr(t.workspace, t.repo, deps.read);
    if (!pr) {
      open.delete(key);
      backoff.delete(key);
      return events;
    }
    open.set(key, {
      repo: `${pr.owner}/${pr.repo}`.toLowerCase(),
      number: pr.number,
      base: pr.baseRefName,
      worktreePath: t.repo.worktreePath,
      headSha: pr.headSha,
    });
    const unsettled = ciState(pr.checks) === "pending" || (pr.mergeable ?? "UNKNOWN") === "UNKNOWN";
    if (!unsettled) {
      backoff.delete(key);
      return events;
    }
    const prev = backoff.get(key);
    const step = prev && prev.headSha === pr.headSha ? Math.min(prev.step + 1, BACKOFF_MINUTES.length - 1) : 0;
    backoff.set(key, { step, at: now + BACKOFF_MINUTES[step] * 60_000, headSha: pr.headSha });
    return events;
  }

  return {
    /** One pass; returns the number of events recorded. */
    async tick(now: number): Promise<number> {
      const targets = await deps.listTargets();
      const live = new Set(targets.map(keyOf));
      for (const m of [open, backoff]) for (const k of m.keys()) if (!live.has(k)) m.delete(k);

      const sinceIso = since;
      // Overlap the previous window so clock skew with GitHub cannot drop a notification; a repeat only costs a read.
      since = new Date(now - 60_000).toISOString();
      let due: Set<string>;
      if (now - lastSweep >= sweepMs) {
        lastSweep = now;
        due = live;
      } else {
        due = await dueBySignal(targets, now, sinceIso);
      }

      let recorded = 0;
      for (const t of targets) {
        if (!due.has(keyOf(t))) continue;
        try {
          recorded += await check(t, now);
        } catch (err) {
          console.warn(`[pr-watcher] ${t.workspace}/${t.repo.repoName}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return recorded;
    },
  };
}
