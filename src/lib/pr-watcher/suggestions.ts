/**
 * What the PR tab proposes doing about a workspace's PRs, derived from what the
 * watcher recorded. Nothing here starts anything: every proposal is a button a
 * person presses.
 *
 * Triage is proposed for comments by people and for CI that is still failing,
 * counting only what happened after the workspace was last handled (a proposal
 * taken or dismissed), and only once comments have been quiet for
 * {@link QUIET_MS} so a review arriving in several comments becomes one triage.
 */

import type { PrEvent, PrWatchSnapshot } from "@/types/pr-watch";

export const QUIET_MS = 5 * 60_000;

export interface PrSuggestions {
  triage: { commentUrls: string[]; failingRepos: string[] } | null;
  conflicts: string[];
  archive: boolean;
}

export const NO_SUGGESTIONS: PrSuggestions = { triage: null, conflicts: [], archive: false };

export function hasSuggestions(s: PrSuggestions): boolean {
  return s.triage !== null || s.conflicts.length > 0 || s.archive;
}

export function computePrSuggestions(input: {
  snapshots: PrWatchSnapshot[];
  events: PrEvent[];
  /** ISO time the workspace was last handled, or null if never. */
  handledAt: string | null;
  /** The gh user's login; aiw comments as this user. */
  self: string | null;
  now: number;
}): PrSuggestions {
  const after = (e: PrEvent) => input.handledAt === null || e.occurredAt > input.handledAt;
  const open = input.snapshots.filter((s) => s.state === "OPEN");

  const comments = input.events.filter(
    (e) => e.kind === "comment" && after(e) && e.url && e.author !== input.self && !e.author?.endsWith("[bot]"),
  );
  const failingRepos = open
    .filter((s) => s.ci === "failing")
    .filter((s) => input.events.some((e) => e.kind === "ci-failing" && e.repoName === s.repoName && after(e)))
    .map((s) => s.repoName);
  const lastComment = comments.reduce((max, e) => Math.max(max, Date.parse(e.occurredAt) || 0), 0);
  const quiet = input.now - lastComment >= QUIET_MS;

  return {
    triage:
      quiet && (comments.length > 0 || failingRepos.length > 0)
        ? { commentUrls: comments.map((e) => e.url!), failingRepos }
        : null,
    conflicts: open.filter((s) => s.mergeable === "CONFLICTING").map((s) => s.repoName),
    archive: input.snapshots.length > 0 && input.snapshots.every((s) => s.state === "MERGED"),
  };
}
