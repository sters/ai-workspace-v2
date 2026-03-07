import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import path from "node:path";

vi.mock("@/lib/config", () => ({
  WORKSPACE_DIR: "/ws",
}));

vi.mock("@/lib/workspace", () => ({
  listWorkspaceRepos: vi.fn(),
}));

vi.mock("@/lib/templates", () => ({
  buildUpdaterPrompt: vi.fn(() => "updater-prompt"),
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

    it("phase has cwd set to repo worktreePath", async () => {
      const phases = await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests" });
      const phase = phases[0];
      if (phase.kind !== "single") throw new Error("expected single");
      expect(phase.cwd).toBe("/repos/my-repo/worktrees/test-ws");
    });

    it("phase has addDirs containing workspace path", async () => {
      const phases = await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests" });
      const phase = phases[0];
      if (phase.kind !== "single") throw new Error("expected single");
      expect(phase.addDirs).toContain(path.join("/ws", "test-ws"));
    });

    it("label is 'Update TODOs'", async () => {
      const phases = await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests" });
      const phase = phases[0];
      if (phase.kind !== "single") throw new Error("expected single");
      expect(phase.label).toBe("Update TODOs");
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

    it("phase has addDirs containing workspace path", async () => {
      const phases = await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests" });
      const phase = phases[0];
      if (phase.kind !== "single") throw new Error("expected single");
      expect(phase.addDirs).toContain(path.join("/ws", "test-ws"));
    });

    it("phase has addDirs containing all repo worktree paths", async () => {
      const phases = await buildUpdateTodoPipeline({ workspace: "test-ws", instruction: "add tests" });
      const phase = phases[0];
      if (phase.kind !== "single") throw new Error("expected single");
      expect(phase.addDirs).toContain("/repos/repo-a/worktrees/test-ws");
      expect(phase.addDirs).toContain("/repos/repo-b/worktrees/test-ws");
    });
  });
});
