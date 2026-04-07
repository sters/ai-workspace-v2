import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/ws",
}));

vi.mock("@/lib/workspace/git", () => ({
  listWorkspaceRepos: vi.fn(),
}));

const mockFileExists = vi.fn();
const mockFileText = vi.fn();
const mockBunWrite = vi.fn();
const originalBunFile = Bun.file;
const originalBunWrite = Bun.write;

Bun.file = vi.fn(() => ({
  exists: mockFileExists,
  text: mockFileText,
})) as unknown as typeof Bun.file;

Bun.write = mockBunWrite as unknown as typeof Bun.write;

afterAll(() => {
  Bun.file = originalBunFile;
  Bun.write = originalBunWrite;
});

import { stripCompletedTodosFromWorkspace } from "@/lib/workspace/todo-cleanup";
import { listWorkspaceRepos } from "@/lib/workspace/git";

const mockListWorkspaceRepos = vi.mocked(listWorkspaceRepos);

describe("stripCompletedTodosFromWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "repo-a",
        repoPath: "repo-a",
        worktreePath: "/ws/test-ws/repo-a",
      },
      {
        repoName: "repo-b",
        repoPath: "repo-b",
        worktreePath: "/ws/test-ws/repo-b",
      },
    ]);
  });

  it("writes back TODO files with completed items removed", async () => {
    mockFileExists.mockResolvedValue(true);
    mockFileText
      .mockResolvedValueOnce("- [x] Done\n- [ ] Pending")
      .mockResolvedValueOnce("- [ ] Only pending");

    const modified = await stripCompletedTodosFromWorkspace("test-ws");

    expect(modified).toEqual(["TODO-repo-a.md"]);
    expect(mockBunWrite).toHaveBeenCalledTimes(1);
    expect(mockBunWrite).toHaveBeenCalledWith(
      "/ws/test-ws/TODO-repo-a.md",
      "- [ ] Pending",
    );
  });

  it("skips missing TODO files", async () => {
    mockFileExists.mockResolvedValue(false);

    const modified = await stripCompletedTodosFromWorkspace("test-ws");

    expect(modified).toEqual([]);
    expect(mockBunWrite).not.toHaveBeenCalled();
  });

  it("does not write when content is unchanged", async () => {
    mockFileExists.mockResolvedValue(true);
    mockFileText.mockResolvedValue("- [ ] Pending only");

    const modified = await stripCompletedTodosFromWorkspace("test-ws");

    expect(modified).toEqual([]);
    expect(mockBunWrite).not.toHaveBeenCalled();
  });

  it("honours repoFilter to process a single repo", async () => {
    mockFileExists.mockResolvedValue(true);
    mockFileText.mockResolvedValueOnce("- [x] Done\n- [ ] Pending");

    const modified = await stripCompletedTodosFromWorkspace("test-ws", "repo-b");

    // Only repo-b should be read — file mock is only called once
    expect(mockFileText).toHaveBeenCalledTimes(1);
    expect(modified).toEqual(["TODO-repo-b.md"]);
    expect(mockBunWrite).toHaveBeenCalledWith(
      "/ws/test-ws/TODO-repo-b.md",
      "- [ ] Pending",
    );
  });
});
