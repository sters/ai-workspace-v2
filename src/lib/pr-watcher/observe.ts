import type { PrChecksSummary, WorkspacePullRequest } from "@/types/pull-request";
import type { PrCiState, PrEventInput, PrEventKind, PrWatchSnapshot } from "@/types/pr-watch";

const MAX_BODY_CHARS = 4000;

export function ciState(checks: PrChecksSummary): PrCiState {
  if (!checks.reported) return "none";
  const c = checks.counts;
  if (c.failure > 0) return "failing";
  if (c.running > 0 || c.queued > 0) return "pending";
  return "passing";
}

/**
 * Compare a fresh read of a PR with what the watcher last saw, returning the
 * events to record and the snapshot to store.
 *
 * A first sighting records the comments already there (they are material for
 * lessons) but no transitions, since there is no earlier state to transition
 * from. `pending` CI and `UNKNOWN` mergeability are GitHub still computing, not
 * a state of their own: the snapshot keeps the last settled value so the next
 * settled one is compared against it.
 */
export function observePr(
  prev: PrWatchSnapshot | null,
  pr: WorkspacePullRequest,
  workspace: string,
  now: string,
): { events: PrEventInput[]; snapshot: PrWatchSnapshot } {
  const base = prev && prev.prUrl === pr.url ? prev : null;
  const events: PrEventInput[] = [];
  const event = (kind: PrEventKind, body: string, extra: Partial<PrEventInput> = {}) =>
    events.push({ workspace, repoName: pr.repoName, prUrl: pr.url, kind, author: null, body, url: null, occurredAt: now, ...extra });

  const seen = new Set(base?.seenComments ?? []);
  const comments = pr.threads
    .flatMap((t) => t.comments.map((c) => ({ ...c, path: t.path })))
    .filter((c) => c.url !== "" && !seen.has(c.url))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const c of comments) {
    seen.add(c.url);
    event("comment", `${c.path ? `${c.path}: ` : ""}${c.body}`.slice(0, MAX_BODY_CHARS), {
      author: c.author,
      url: c.url,
      occurredAt: c.createdAt || now,
    });
  }

  const ci = ciState(pr.checks);
  const mergeable = pr.mergeable ?? "UNKNOWN";
  const settledCi = ci === "pending" && base ? base.ci : ci;
  const settledMergeable = mergeable === "UNKNOWN" && base ? base.mergeable : mergeable;

  if (base) {
    if (pr.headSha && pr.headSha !== base.headSha) event("push", `Head moved to ${pr.headSha.slice(0, 12)}`);
    if (settledCi !== base.ci) {
      if (settledCi === "failing") {
        const failing = pr.checks.checks.filter((c) => c.state === "failure").map((c) => c.name);
        event("ci-failing", `CI failing${failing.length ? `: ${failing.join(", ")}` : ""}`);
      } else if (settledCi === "passing") {
        event("ci-passing", "CI passing");
      }
    }
    if (settledMergeable !== base.mergeable) {
      if (settledMergeable === "CONFLICTING") event("conflict", "Conflicts with the base branch");
      else if (base.mergeable === "CONFLICTING") event("conflict-resolved", "No longer conflicts with the base branch");
    }
    if (pr.state !== base.state) {
      if (pr.state === "MERGED") event("merged", "Merged");
      else if (pr.state === "CLOSED") event("closed", "Closed without merging");
      else if (pr.state === "OPEN") event("reopened", "Reopened");
    }
  }

  return {
    events,
    snapshot: {
      workspace,
      repoName: pr.repoName,
      prUrl: pr.url,
      state: pr.state,
      headSha: pr.headSha,
      ci: settledCi,
      mergeable: settledMergeable,
      seenComments: [...seen],
    },
  };
}
