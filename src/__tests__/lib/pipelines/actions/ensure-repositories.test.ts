import { vi, describe, it, expect, beforeEach } from "vitest";

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

import { syncReadmeRepositories } from "@/lib/pipelines/actions/ensure-repositories";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { readWorkspaceReadme } from "@/lib/parsers/readme";
import { setupRepository } from "@/lib/pipelines/actions/setup-repository";

const mockList = vi.mocked(listWorkspaceRepos);
const mockReadReadme = vi.mocked(readWorkspaceReadme);
const mockSetup = vi.mocked(setupRepository);

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
