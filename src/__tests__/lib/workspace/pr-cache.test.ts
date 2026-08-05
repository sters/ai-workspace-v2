import { describe, it, expect, vi, beforeEach } from "vitest";

const mockList = vi.fn();

vi.mock("@/lib/workspace/pr-threads", () => ({
  listWorkspacePullRequests: (...args: unknown[]) => mockList(...args),
}));

import {
  PR_CACHE_TTL_MS,
  _resetPrCache,
  getCachedPullRequests,
  invalidatePullRequestCache,
} from "@/lib/workspace/pr-cache";

function result(title: string) {
  return {
    pullRequests: [{ title } as never],
    problems: [],
  };
}

beforeEach(() => {
  _resetPrCache();
  mockList.mockReset();
  mockList.mockImplementation(async () => result("first"));
});

describe("getCachedPullRequests", () => {
  it("reads through on a cold cache", async () => {
    const got = await getCachedPullRequests("ws", { now: 1000 });
    expect(got.pullRequests[0]).toMatchObject({ title: "first" });
    expect(mockList).toHaveBeenCalledWith("ws");
  });

  it("serves a second read inside the TTL without touching gh", async () => {
    await getCachedPullRequests("ws", { now: 1000 });
    await getCachedPullRequests("ws", { now: 1000 + PR_CACHE_TTL_MS - 1 });
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("reads again once the TTL has passed", async () => {
    await getCachedPullRequests("ws", { now: 1000 });
    mockList.mockImplementation(async () => result("second"));
    const got = await getCachedPullRequests("ws", { now: 1000 + PR_CACHE_TTL_MS });
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(got.pullRequests[0]).toMatchObject({ title: "second" });
  });

  it("caches per workspace, not globally", async () => {
    await getCachedPullRequests("a", { now: 1000 });
    await getCachedPullRequests("b", { now: 1000 });
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(mockList).toHaveBeenCalledWith("a");
    expect(mockList).toHaveBeenCalledWith("b");
  });

  it("bypasses and replaces the entry when forced", async () => {
    await getCachedPullRequests("ws", { now: 1000 });
    mockList.mockImplementation(async () => result("forced"));

    const forced = await getCachedPullRequests("ws", { now: 1001, force: true });
    expect(forced.pullRequests[0]).toMatchObject({ title: "forced" });

    // The forced read is what a subsequent cached read sees, so a Refresh does
    // not leave the stale entry behind for the next visitor.
    const after = await getCachedPullRequests("ws", { now: 1002 });
    expect(after.pullRequests[0]).toMatchObject({ title: "forced" });
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent reads into one gh call", async () => {
    // Two browser tabs, or SWR revalidating on focus while the first load is
    // still in flight: caching the promise rather than the value is what makes
    // this one round trip instead of two.
    let release: (value: unknown) => void = () => {};
    mockList.mockImplementation(() => new Promise((r) => { release = r; }));

    const first = getCachedPullRequests("ws", { now: 1000 });
    const second = getCachedPullRequests("ws", { now: 1000 });
    release(result("shared"));

    expect(await first).toBe(await second);
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure — the next read retries", async () => {
    // A rejection here means the workspace could not be listed at all. Holding
    // that for the full TTL would keep showing an error after it was fixed.
    mockList.mockImplementation(async () => { throw new Error("no such workspace"); });
    await expect(getCachedPullRequests("ws", { now: 1000 })).rejects.toThrow("no such workspace");

    mockList.mockImplementation(async () => result("recovered"));
    const got = await getCachedPullRequests("ws", { now: 1001 });
    expect(got.pullRequests[0]).toMatchObject({ title: "recovered" });
  });
});

describe("invalidatePullRequestCache", () => {
  it("drops one workspace's entry", async () => {
    await getCachedPullRequests("a", { now: 1000 });
    await getCachedPullRequests("b", { now: 1000 });

    invalidatePullRequestCache("a");
    await getCachedPullRequests("a", { now: 1001 });
    await getCachedPullRequests("b", { now: 1001 });

    expect(mockList).toHaveBeenCalledTimes(3);
  });

  it("drops everything when given no workspace", async () => {
    await getCachedPullRequests("a", { now: 1000 });
    invalidatePullRequestCache();
    await getCachedPullRequests("a", { now: 1001 });
    expect(mockList).toHaveBeenCalledTimes(2);
  });
});
