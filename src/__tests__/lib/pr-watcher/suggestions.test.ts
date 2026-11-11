import { describe, expect, it } from "vitest";
import { computePrSuggestions } from "@/lib/pr-watcher/suggestions";
import type { PrEvent, PrEventKind, PrWatchSnapshot } from "@/types/pr-watch";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function snap(repoName: string, overrides: Partial<PrWatchSnapshot> = {}): PrWatchSnapshot {
  return {
    workspace: "ws", repoName, prUrl: `https://github.com/acme/${repoName}/pull/1`,
    state: "OPEN", headSha: "a", ci: "passing", mergeable: "MERGEABLE", seenComments: [],
    ...overrides,
  };
}

let nextId = 1;
function ev(kind: PrEventKind, occurredAt: string, overrides: Partial<PrEvent> = {}): PrEvent {
  const id = nextId++;
  return {
    id, workspace: "ws", repoName: "widgets", prUrl: "https://github.com/acme/widgets/pull/1",
    kind, author: "reviewer", body: "", url: `https://github.com/acme/widgets/pull/1#c${id}`, occurredAt,
    ...overrides,
  };
}

const base = { handledAt: null, self: "me", now: NOW };

describe("computePrSuggestions", () => {
  it("proposes triage of a person's comment once comments have been quiet for five minutes", () => {
    const c = ev("comment", ago(6));
    const s = computePrSuggestions({ ...base, snapshots: [snap("widgets")], events: [c] });
    expect(s.triage).toEqual({ commentUrls: [c.url], failingRepos: [] });
  });

  it("waits while comments are still arriving, even with CI failing", () => {
    const s = computePrSuggestions({
      ...base,
      snapshots: [snap("widgets", { ci: "failing" })],
      events: [ev("comment", ago(10)), ev("ci-failing", ago(8)), ev("comment", ago(2))],
    });
    expect(s.triage).toBeNull();
  });

  it("leaves out comments by bots and by the user aiw acts as", () => {
    const s = computePrSuggestions({
      ...base,
      snapshots: [snap("widgets")],
      events: [ev("comment", ago(30), { author: "lint-helper[bot]" }), ev("comment", ago(30), { author: "me" })],
    });
    expect(s.triage).toBeNull();
  });

  it("leaves out what came before the workspace was last handled", () => {
    const old = ev("comment", ago(60));
    const fresh = ev("comment", ago(10));
    const s = computePrSuggestions({ ...base, handledAt: ago(30), snapshots: [snap("widgets")], events: [old, fresh] });
    expect(s.triage?.commentUrls).toEqual([fresh.url]);
  });

  it("includes a CI failure only while it is still failing and newer than the last handling", () => {
    const failing = [snap("widgets", { ci: "failing" })];
    expect(
      computePrSuggestions({ ...base, snapshots: failing, events: [ev("ci-failing", ago(10))] }).triage,
    ).toEqual({ commentUrls: [], failingRepos: ["widgets"] });
    expect(
      computePrSuggestions({ ...base, handledAt: ago(5), snapshots: failing, events: [ev("ci-failing", ago(10))] }).triage,
    ).toBeNull();
    expect(
      computePrSuggestions({ ...base, snapshots: [snap("widgets")], events: [ev("ci-failing", ago(10))] }).triage,
    ).toBeNull();
  });

  it("proposes resolving conflicts on open PRs only", () => {
    const s = computePrSuggestions({
      ...base,
      snapshots: [snap("widgets", { mergeable: "CONFLICTING" }), snap("gadgets", { mergeable: "CONFLICTING", state: "CLOSED" })],
      events: [],
    });
    expect(s.conflicts).toEqual(["widgets"]);
  });

  it("proposes archiving once every PR is merged", () => {
    const merged = snap("widgets", { state: "MERGED" });
    expect(computePrSuggestions({ ...base, snapshots: [merged], events: [] }).archive).toBe(true);
    expect(computePrSuggestions({ ...base, snapshots: [merged, snap("gadgets")], events: [] }).archive).toBe(false);
    expect(computePrSuggestions({ ...base, snapshots: [], events: [] }).archive).toBe(false);
  });
});
