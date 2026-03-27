import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/ws",
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

  describe("single repo", () => {
    beforeEach(() => {
      mockListWorkspaceRepos.mockReturnValue([
        {
          repoName: "my-repo",
          repoPath: "/repos/my-repo",
          worktreePath: "/repos/my-repo/worktrees/test-ws",
        } as ReturnType<typeof listWorkspaceRepos>[number],
      ]);
    });

    it("returns a single phase", async () => {
      const phases = await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests" });
      expect(phases).toHaveLength(1);
    });

    it("phase has kind single", async () => {
      const phases = await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests" });
      expect(phases[0].kind).toBe("single");
    });

    it("phase does not set cwd (uses getResolvedWorkspaceRoot default)", async () => {
      const phases = await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests" });
      const phase = phases[0];
      if (phase.kind !== "single") throw new Error("expected single");
      expect(phase.cwd).toBeUndefined();
    });

    it("phase sets addDirs to workspace path", async () => {
      const phases = await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests" });
      const phase = phases[0];
      if (phase.kind !== "single") throw new Error("expected single");
      expect(phase.addDirs).toEqual([expect.stringContaining("test-ws")]);
    });

    it("label is 'Update TODOs'", async () => {
      const phases = await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests" });
      const phase = phases[0];
      if (phase.kind !== "single") throw new Error("expected single");
      expect(phase.label).toBe("Update TODOs");
    });
  });

  describe("Best-of-N mode", () => {
    beforeEach(() => {
      mockListWorkspaceRepos.mockReturnValue([
        {
          repoName: "my-repo",
          repoPath: "/repos/my-repo",
          worktreePath: "/repos/my-repo/worktrees/test-ws",
        } as ReturnType<typeof listWorkspaceRepos>[number],
      ]);
    });

    it("returns a function phase when bestOfN >= 2", async () => {
      const phases = await buildUpdateTodoPipeline({
        workspace: "test-ws",
        instruction: "add tests",
        bestOfN: 3,
      });
      expect(phases).toHaveLength(1);
      expect(phases[0].kind).toBe("function");
    });

    it("returns a single phase when bestOfN is undefined", async () => {
      const phases = await buildUpdateTodoPipeline({
        workspace: "test-ws",
        instruction: "add tests",
      });
      expect(phases[0].kind).toBe("single");
    });

    it("returns a single phase when bestOfN < 2", async () => {
      const phases = await buildUpdateTodoPipeline({
        workspace: "test-ws",
        instruction: "add tests",
        bestOfN: 1,
      });
      expect(phases[0].kind).toBe("single");
    });

    it("function phase label includes Best-of-N", async () => {
      const phases = await buildUpdateTodoPipeline({
        workspace: "test-ws",
        instruction: "add tests",
        bestOfN: 2,
      });
      const phase = phases[0];
      if (phase.kind !== "function") throw new Error("expected function");
      expect(phase.label).toBe("Update TODOs (Best-of-N)");
    });
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

    it("returns a single phase", async () => {
      const phases = await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests" });
      expect(phases).toHaveLength(1);
    });

    it("phase does not set cwd but sets addDirs", async () => {
      const phases = await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests" });
      const phase = phases[0];
      if (phase.kind !== "single") throw new Error("expected single");
      expect(phase.cwd).toBeUndefined();
      expect(phase.addDirs).toEqual([expect.stringContaining("test-ws")]);
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
