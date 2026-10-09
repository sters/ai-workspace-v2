import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/ws",
}));

vi.mock("@/lib/workspace", () => ({
  listWorkspaceRepos: vi.fn(),
}));

vi.mock("@/lib/templates", () => ({
  buildUpdaterPrompt: vi.fn(() => "updater-prompt"),
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/updater.md"),
  ensureGlobalSystemPrompt: vi.fn(() => "/mock/prompts/global.md"),
}));

const mockFileExists = vi.fn();
const mockFileText = vi.fn();
const originalBunFile = Bun.file;
Bun.file = vi.fn(() => ({
  exists: mockFileExists,
  text: mockFileText,
})) as unknown as typeof Bun.file;

afterAll(() => {
  Bun.file = originalBunFile;
});

import { buildUpdateTodoPipeline } from "@/lib/pipelines/update-todo";
import { listWorkspaceRepos } from "@/lib/workspace";

const mockListWorkspaceRepos = vi.mocked(listWorkspaceRepos);

describe("buildUpdateTodoPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue(false);
    mockFileText.mockResolvedValue("");
  });

  describe("multiple repos", () => {
    beforeEach(() => {
      mockListWorkspaceRepos.mockReturnValue([
        {
          repoName: "repo-a",
          repoPath: "/repos/repo-a",
          worktreePath: "/repos/repo-a/worktrees/test-ws",
        } as ReturnType<typeof listWorkspaceRepos>[number],
        {
          repoName: "repo-b",
          repoPath: "/repos/repo-b",
          worktreePath: "/repos/repo-b/worktrees/test-ws",
        } as ReturnType<typeof listWorkspaceRepos>[number],
      ]);
    });

    it("filters to specified repo when repo parameter is provided", async () => {
      const { buildUpdaterPrompt } = await import("@/lib/templates");
      const mockBuildUpdaterPrompt = vi.mocked(buildUpdaterPrompt);
      mockBuildUpdaterPrompt.mockClear();

      await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests", repo: "repo-b" });

      // Should only be called once for repo-b, not for both repos
      expect(mockBuildUpdaterPrompt).toHaveBeenCalledTimes(1);
      expect(mockBuildUpdaterPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ repoName: "repo-b" }),
      );
    });

    it("processes all repos when repo parameter is omitted", async () => {
      const { buildUpdaterPrompt } = await import("@/lib/templates");
      const mockBuildUpdaterPrompt = vi.mocked(buildUpdaterPrompt);
      mockBuildUpdaterPrompt.mockClear();

      await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests" });

      expect(mockBuildUpdaterPrompt).toHaveBeenCalledTimes(2);
    });
  });
});
