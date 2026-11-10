// @vitest-environment node
import { describe, expect, it } from "vitest";
import { observePr } from "@/lib/pr-watcher/observe";
import type { PrChecksSummary, PrReviewThread, WorkspacePullRequest } from "@/types/pull-request";
import type { PrWatchSnapshot } from "@/types/pr-watch";

const NOW = "2026-01-02T00:00:00.000Z";

function checks(partial: Partial<PrChecksSummary["counts"]>, reported = true): PrChecksSummary {
  return {
    checks: [],
    counts: { success: 0, failure: 0, running: 0, queued: 0, skipped: 0, cancelled: 0, unknown: 0, ...partial },
    reported,
  };
}

function thread(url: string, author = "alice", createdAt = "2026-01-01T10:00:00Z"): PrReviewThread {
  return {
    id: `T_${url}`,
    kind: "review-thread",
    isResolved: false,
    isOutdated: false,
    path: "src/a.ts",
    line: 3,
    comments: [{ url, author, body: `body of ${url}`, createdAt }],
  };
}

function pr(overrides: Partial<WorkspacePullRequest> = {}): WorkspacePullRequest {
  return {
    repoName: "widgets",
    repoPath: "github.com/acme/widgets",
    worktreePath: "/ws/widgets",
    host: "github.com",
    owner: "acme",
    repo: "widgets",
    number: 7,
    url: "https://github.com/acme/widgets/pull/7",
    title: "t",
    state: "OPEN",
    isDraft: false,
    headRefName: "feat",
    headSha: "aaa",
    baseRefName: "main",
    author: "me",
    updatedAt: "",
    mergeable: "MERGEABLE",
    threads: [],
    checks: checks({ success: 2 }),
    ...overrides,
  };
}

function snapshotOf(p: WorkspacePullRequest, seen: string[] = []): PrWatchSnapshot {
  return {
    workspace: "ws",
    repoName: p.repoName,
    prUrl: p.url,
    state: p.state,
    headSha: p.headSha,
    ci: "passing",
    mergeable: p.mergeable ?? "UNKNOWN",
    seenComments: seen,
  };
}

describe("observePr", () => {
  it("records existing comments but no state transitions on first sight", () => {
    const { events, snapshot } = observePr(null, pr({ threads: [thread("u1")], checks: checks({ failure: 1 }) }), "ws", NOW);
    expect(events.map((e) => e.kind)).toEqual(["comment"]);
    expect(events[0]).toMatchObject({ author: "alice", url: "u1", occurredAt: "2026-01-01T10:00:00Z" });
    expect(snapshot.ci).toBe("failing");
    expect(snapshot.seenComments).toEqual(["u1"]);
  });

  it("emits only comments it has not seen", () => {
    const current = pr({ threads: [thread("u1"), thread("u2", "bob")] });
    const { events } = observePr(snapshotOf(current, ["u1"]), current, "ws", NOW);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "comment", author: "bob", url: "u2" });
  });

  it("reports a head move, a CI flip, a conflict and a merge against the last snapshot", () => {
    const before = pr();
    const after = pr({ headSha: "bbb", checks: checks({ failure: 1, success: 1 }), mergeable: "CONFLICTING", state: "MERGED" });
    const kinds = observePr(snapshotOf(before), after, "ws", NOW).events.map((e) => e.kind);
    expect(kinds).toEqual(["push", "ci-failing", "conflict", "merged"]);
  });

  it("keeps the last settled CI state while checks are still running", () => {
    const { events, snapshot } = observePr(snapshotOf(pr()), pr({ checks: checks({ running: 1, success: 1 }) }), "ws", NOW);
    expect(snapshot.ci).toBe("passing");
    expect(events).toEqual([]);
    const next = observePr(snapshot, pr({ checks: checks({ failure: 1 }) }), "ws", NOW);
    expect(next.events.map((e) => e.kind)).toEqual(["ci-failing"]);
  });

  it("reports CI recovery and conflict resolution", () => {
    const prev = { ...snapshotOf(pr()), ci: "failing" as const, mergeable: "CONFLICTING" };
    const kinds = observePr(prev, pr(), "ws", NOW).events.map((e) => e.kind);
    expect(kinds).toEqual(["ci-passing", "conflict-resolved"]);
  });

  it("starts over when the branch now has a different PR", () => {
    const prev = snapshotOf(pr({ url: "https://github.com/acme/widgets/pull/6" }), ["u1"]);
    const { events } = observePr(prev, pr({ threads: [thread("u1")], headSha: "zzz" }), "ws", NOW);
    expect(events.map((e) => e.kind)).toEqual(["comment"]);
  });

  it("does not report a mergeability GitHub has not computed yet", () => {
    const { events } = observePr(snapshotOf(pr()), pr({ mergeable: "UNKNOWN" }), "ws", NOW);
    expect(events).toEqual([]);
  });
});
