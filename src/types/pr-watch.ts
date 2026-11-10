/** Overall CI state of a PR's head commit. `none` means GitHub reported no checks. */
export type PrCiState = "passing" | "failing" | "pending" | "none";

/** What the watcher last saw of the PR on one worktree's branch. */
export interface PrWatchSnapshot {
  workspace: string;
  repoName: string;
  prUrl: string;
  /** OPEN / CLOSED / MERGED. */
  state: string;
  headSha: string;
  ci: PrCiState;
  /** MERGEABLE / CONFLICTING / UNKNOWN. */
  mergeable: string;
  /** Permalinks of every comment already recorded as an event. */
  seenComments: string[];
}

export const PR_EVENT_KINDS = [
  "comment",
  "push",
  "ci-failing",
  "ci-passing",
  "conflict",
  "conflict-resolved",
  "merged",
  "closed",
  /** Closed by aiw when its workspace was archived — not a reviewer's rejection. */
  "closed-by-archive",
  "reopened",
] as const;

export type PrEventKind = (typeof PR_EVENT_KINDS)[number];

export interface PrEventInput {
  workspace: string;
  repoName: string;
  prUrl: string;
  kind: PrEventKind;
  author: string | null;
  body: string;
  url: string | null;
  /** When it happened on GitHub when known, else when the watcher saw it. */
  occurredAt: string;
}

export interface PrEvent extends PrEventInput {
  id: number;
}
