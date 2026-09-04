import { vi, describe, it, expect, beforeEach } from "vitest";
import type { PhaseFunctionContext } from "@/types/pipeline";

vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/ws",
}));
vi.mock("@/lib/workspace/git", () => ({
  listWorkspaceRepos: vi.fn(),
}));
vi.mock("@/lib/parsers/readme", () => ({
  readWorkspaceReadme: vi.fn(),
  denormalizeRepoPath: (s: string) => s.replace("___", ":"),
}));
vi.mock("@/lib/pipelines/actions/setup-repository", () => ({
  setupRepository: vi.fn(),
}));
const mockConstraintsFn = vi.fn(async () => true);
vi.mock("@/lib/pipelines/actions/discover-constraints", () => ({
  buildDiscoverConstraintsPhase: vi.fn(() => ({
    kind: "function",
    label: "Discover repo constraints",
    fn: mockConstraintsFn,
  })),
}));

import {
  syncReadmeRepositories,
  discoverConstraintsForNewRepos,
} from "@/lib/pipelines/actions/ensure-repositories";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { readWorkspaceReadme } from "@/lib/parsers/readme";
import { setupRepository } from "@/lib/pipelines/actions/setup-repository";
import { buildDiscoverConstraintsPhase } from "@/lib/pipelines/actions/discover-constraints";

const mockList = vi.mocked(listWorkspaceRepos);
const mockReadReadme = vi.mocked(readWorkspaceReadme);
const mockSetup = vi.mocked(setupRepository);
const mockBuildConstraints = vi.mocked(buildDiscoverConstraintsPhase);

function createMockCtx(): PhaseFunctionContext {
  return {
    operationId: "test-op",
    emitStatus: vi.fn(),
    emitResult: vi.fn(),
    emitAsk: vi.fn(),
    setWorkspace: vi.fn(),
    runChild: vi.fn(async () => true),
    runChildGroup: vi.fn(async () => [true]),
    emitTerminal: vi.fn(),
    signal: new AbortController().signal,
    appendPhases: vi.fn(),
  };
}

function meta(repositories: { alias: string; path: string; baseBranch: string }[]) {
  return {
    content: "",
    meta: { title: "t", taskType: "feature", ticketId: "", date: "", repositories },
  };
}

describe("syncReadmeRepositories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a read error and sets up nothing when README cannot be read", async () => {
    mockReadReadme.mockRejectedValue(new Error("boom"));
    mockList.mockReturnValue([
      { repoPath: "github.com/a/b", repoName: "b", worktreePath: "/x" },
    ]);

    const res = await syncReadmeRepositories("ws", vi.fn());

    expect(res.readError).toContain("boom");
    expect(res.existingCount).toBe(1);
    expect(res.setUp).toEqual([]);
    expect(res.stillMissing).toEqual([]);
    expect(mockSetup).not.toHaveBeenCalled();
  });

  it("does nothing when every README repository is already on disk", async () => {
    mockReadReadme.mockResolvedValue(
      meta([{ alias: "b", path: "github.com/a/b", baseBranch: "main" }]),
    );
    mockList.mockReturnValue([
      { repoPath: "github.com/a/b", repoName: "b", worktreePath: "/x" },
    ]);

    const res = await syncReadmeRepositories("ws", vi.fn());

    expect(res.metaRepoCount).toBe(1);
    expect(res.existingCount).toBe(1);
    expect(res.setUp).toEqual([]);
    expect(res.stillMissing).toEqual([]);
    expect(mockSetup).not.toHaveBeenCalled();
    // Only the pre-setup listing happens; no second listing needed.
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("sets up only the repositories missing from disk", async () => {
    mockReadReadme.mockResolvedValue(
      meta([
        { alias: "already", path: "github.com/a/already", baseBranch: "main" },
        { alias: "new", path: "github.com/a/new", baseBranch: "dev" },
      ]),
    );
    mockList
      .mockReturnValueOnce([
        { repoPath: "github.com/a/already", repoName: "already", worktreePath: "/a" },
      ])
      .mockReturnValueOnce([
        { repoPath: "github.com/a/already", repoName: "already", worktreePath: "/a" },
        { repoPath: "github.com/a/new", repoName: "new", worktreePath: "/b" },
      ]);

    const res = await syncReadmeRepositories("ws", vi.fn());

    expect(mockSetup).toHaveBeenCalledTimes(1);
    expect(mockSetup).toHaveBeenCalledWith(
      "ws",
      "github.com/a/new",
      "dev",
      expect.any(Function),
    );
    expect(res.setUp).toEqual(["github.com/a/new"]);
    expect(res.stillMissing).toEqual([]);
  });

  it("resolves the newly set up repositories to their on-disk worktrees", async () => {
    mockReadReadme.mockResolvedValue(
      meta([
        { alias: "already", path: "github.com/a/already", baseBranch: "main" },
        { alias: "new", path: "github.com/a/new", baseBranch: "main" },
      ]),
    );
    mockList
      .mockReturnValueOnce([
        { repoPath: "github.com/a/already", repoName: "already", worktreePath: "/a" },
      ])
      .mockReturnValueOnce([
        { repoPath: "github.com/a/already", repoName: "already", worktreePath: "/a" },
        { repoPath: "github.com/a/new", repoName: "new", worktreePath: "/b" },
      ]);

    const res = await syncReadmeRepositories("ws", vi.fn());

    // Follow-on setup work (constraint discovery) needs the name and worktree,
    // which only the post-setup listing knows.
    expect(res.setUpRepos).toEqual([{ repoName: "new", worktreePath: "/b" }]);
  });

  it("reports no new worktrees when nothing was set up", async () => {
    mockReadReadme.mockResolvedValue(
      meta([{ alias: "b", path: "github.com/a/b", baseBranch: "main" }]),
    );
    mockList.mockReturnValue([
      { repoPath: "github.com/a/b", repoName: "b", worktreePath: "/x" },
    ]);

    const res = await syncReadmeRepositories("ws", vi.fn());

    expect(res.setUpRepos).toEqual([]);
  });

  it("reports no new worktrees when the README cannot be read", async () => {
    mockReadReadme.mockRejectedValue(new Error("boom"));
    mockList.mockReturnValue([]);

    const res = await syncReadmeRepositories("ws", vi.fn());

    expect(res.setUpRepos).toEqual([]);
  });

  it("reports stillMissing when a setup attempt fails", async () => {
    mockReadReadme.mockResolvedValue(
      meta([{ alias: "y", path: "github.com/x/y", baseBranch: "main" }]),
    );
    mockList.mockReturnValue([]); // never set up
    mockSetup.mockImplementation(() => {
      throw new Error("clone failed");
    });

    const res = await syncReadmeRepositories("ws", vi.fn());

    expect(res.setUp).toEqual([]);
    expect(res.stillMissing).toEqual(["github.com/x/y"]);
  });

  it("denormalizes the repo path before calling setupRepository", async () => {
    mockReadReadme.mockResolvedValue(
      meta([{ alias: "dev", path: "github.com/a/b___dev", baseBranch: "main" }]),
    );
    mockList
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { repoPath: "github.com/a/b___dev", repoName: "b", worktreePath: "/b" },
      ]);

    await syncReadmeRepositories("ws", vi.fn());

    expect(mockSetup).toHaveBeenCalledWith(
      "ws",
      "github.com/a/b:dev",
      "main",
      expect.any(Function),
    );
  });

  describe("discoverConstraintsForNewRepos", () => {
    beforeEach(() => {
      mockConstraintsFn.mockResolvedValue(true);
    });

    it("discovers constraints for the worktrees just set up", async () => {
      const ctx = createMockCtx();

      const ok = await discoverConstraintsForNewRepos(ctx, "ws", [
        { repoName: "new", worktreePath: "/ws/ws/github.com/a/new" },
      ]);

      expect(ok).toBe(true);
      expect(mockBuildConstraints).toHaveBeenCalledWith({
        workspace: "ws",
        wsPath: "/ws/ws",
        repos: [{ repoName: "new", worktreePath: "/ws/ws/github.com/a/new" }],
      });
      expect(mockConstraintsFn).toHaveBeenCalledWith(ctx);
    });

    it("does nothing when no repository was set up", async () => {
      const ok = await discoverConstraintsForNewRepos(createMockCtx(), "ws", []);

      expect(ok).toBe(true);
      expect(mockBuildConstraints).not.toHaveBeenCalled();
    });

    it("reports the phase's own failure to the caller", async () => {
      mockConstraintsFn.mockResolvedValue(false);

      const ok = await discoverConstraintsForNewRepos(createMockCtx(), "ws", [
        { repoName: "new", worktreePath: "/w" },
      ]);

      expect(ok).toBe(false);
    });
  });

  it("stops setting up further repositories once the signal aborts", async () => {
    mockReadReadme.mockResolvedValue(
      meta([
        { alias: "one", path: "github.com/a/one", baseBranch: "main" },
        { alias: "two", path: "github.com/a/two", baseBranch: "main" },
      ]),
    );
    mockList.mockReturnValue([]);
    const controller = new AbortController();
    controller.abort();

    await syncReadmeRepositories("ws", vi.fn(), controller.signal);

    expect(mockSetup).not.toHaveBeenCalled();
  });
});
