import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceRepo } from "@/types/workspace";

const mockRead = vi.fn();
const mockRepos = vi.fn();

vi.mock("@/lib/workspace/pr-threads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace/pr-threads")>()),
  readRepoPullRequest: (...args: unknown[]) => mockRead(...args),
}));

vi.mock("@/lib/workspace/git", () => ({
  listWorkspaceRepos: (...args: unknown[]) => mockRepos(...args),
}));

import {
  PR_CACHE_TTL_MS,
  _resetPrCache,
  getCachedPullRequests,
  getCachedRepoPullRequest,
  invalidatePullRequestCache,
} from "@/lib/workspace/pr-cache";

function repo(name: string): WorkspaceRepo {
  return { repoName: name, repoPath: `github.com/acme/${name}`, worktreePath: `/ws/${name}` };
}

const widgets = repo("widgets");
const gadgets = repo("gadgets");

function read(title: string) {
  return { pr: { title } as never };
}

beforeEach(() => {
  _resetPrCache();
  mockRead.mockReset();
  mockRead.mockImplementation(async () => read("first"));
  mockRepos.mockReset();
  mockRepos.mockResolvedValue([widgets]);
});

describe("getCachedRepoPullRequest", () => {
  it("serves a second read inside the TTL without touching gh", async () => {
    await getCachedRepoPullRequest("ws", widgets, { now: 1000 });
    await getCachedRepoPullRequest("ws", widgets, { now: 1000 + PR_CACHE_TTL_MS - 1 });
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it("reads again once the TTL has passed", async () => {
    await getCachedRepoPullRequest("ws", widgets, { now: 1000 });
    mockRead.mockImplementation(async () => read("second"));
    const got = await getCachedRepoPullRequest("ws", widgets, { now: 1000 + PR_CACHE_TTL_MS });
    expect(mockRead).toHaveBeenCalledTimes(2);
    expect(got.pr).toMatchObject({ title: "second" });
  });

  it("caches per workspace and repository", async () => {
    await getCachedRepoPullRequest("a", widgets, { now: 1000 });
    await getCachedRepoPullRequest("b", widgets, { now: 1000 });
    await getCachedRepoPullRequest("a", gadgets, { now: 1000 });
    expect(mockRead).toHaveBeenCalledTimes(3);
  });

  it("bypasses and replaces the entry when forced", async () => {
    await getCachedRepoPullRequest("ws", widgets, { now: 1000 });
    mockRead.mockImplementation(async () => read("forced"));

    const forced = await getCachedRepoPullRequest("ws", widgets, { now: 1001, force: true });
    expect(forced.pr).toMatchObject({ title: "forced" });

    // The forced read is what a subsequent cached read sees, so a Refresh does
    // not leave the stale entry behind for the next visitor.
    const after = await getCachedRepoPullRequest("ws", widgets, { now: 1002 });
    expect(after.pr).toMatchObject({ title: "forced" });
    expect(mockRead).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent reads into one gh call", async () => {
    let release: (value: unknown) => void = () => {};
    mockRead.mockImplementation(() => new Promise((r) => { release = r; }));

    const first = getCachedRepoPullRequest("ws", widgets, { now: 1000 });
    const second = getCachedRepoPullRequest("ws", widgets, { now: 1000 });
    release(read("shared"));

    expect(await first).toBe(await second);
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure — the next read retries", async () => {
    mockRead.mockImplementation(async () => { throw new Error("boom"); });
    await expect(getCachedRepoPullRequest("ws", widgets, { now: 1000 })).rejects.toThrow("boom");

    mockRead.mockImplementation(async () => read("recovered"));
    const got = await getCachedRepoPullRequest("ws", widgets, { now: 1001 });
    expect(got.pr).toMatchObject({ title: "recovered" });
  });
});

describe("getCachedPullRequests", () => {
  it("shares entries with the per-repository read", async () => {
    // The tab reads per repository while review freshness reads the workspace;
    // having both open must not cost a second round trip.
    await getCachedRepoPullRequest("ws", widgets, { now: 1000 });
    await getCachedPullRequests("ws", { now: 1001 });
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it("keeps a repository without a PR as a problem", async () => {
    mockRepos.mockResolvedValue([widgets, gadgets]);
    mockRead.mockImplementation(async (r: WorkspaceRepo) =>
      r.repoName === "widgets"
        ? read("cache")
        : { problem: { repoName: "gadgets", reason: "no pull requests found" } },
    );

    const got = await getCachedPullRequests("ws", { now: 1000 });
    expect(got.pullRequests).toEqual([{ title: "cache" }]);
    expect(got.problems).toEqual([{ repoName: "gadgets", reason: "no pull requests found" }]);
  });
});

describe("invalidatePullRequestCache", () => {
  it("drops one workspace's entries", async () => {
    await getCachedRepoPullRequest("a", widgets, { now: 1000 });
    await getCachedRepoPullRequest("b", widgets, { now: 1000 });

    invalidatePullRequestCache("a");
    await getCachedRepoPullRequest("a", widgets, { now: 1001 });
    await getCachedRepoPullRequest("b", widgets, { now: 1001 });

    expect(mockRead).toHaveBeenCalledTimes(3);
  });

  it("drops everything when given no workspace", async () => {
    await getCachedRepoPullRequest("a", widgets, { now: 1000 });
    invalidatePullRequestCache();
    await getCachedRepoPullRequest("a", widgets, { now: 1001 });
    expect(mockRead).toHaveBeenCalledTimes(2);
  });
});
