import { describe, it, expect, vi, beforeEach } from "vitest";
import { pathExists } from "@/lib/fs";

// Mock helpers before importing the module under test
const mockExec = vi.fn();
const mockRepoDir = vi.fn();

vi.mock("@/lib/workspace/helpers", () => ({
  exec: (...args: unknown[]) => mockExec(...args),
  repoDir: () => mockRepoDir(),
}));

vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/tmp/test-workspace",
}));

vi.mock("@/lib/fs", () => ({ pathExists: vi.fn(async () => false) }));

vi.mock("node:fs/promises", () => {
  const fs = { mkdir: vi.fn(async () => {}), rm: vi.fn(async () => {}) };
  return { ...fs, default: fs };
});

import {
  createSubWorktrees,
  getSubWorktreeDiff,
  getBaseCommit,
  applySubWorktreeResult,
  cleanupSubWorktrees,
} from "@/lib/pipelines/actions/best-of-n-worktree";
import type { WorkspaceRepo } from "@/types/workspace";

describe("best-of-n-worktree", () => {
  const repos: WorkspaceRepo[] = [
    {
      repoPath: "github.com/org/repo",
      repoName: "repo",
      worktreePath: "/tmp/test-workspace/my-ws/github.com/org/repo",
    },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRepoDir.mockReturnValue("/tmp/test-repos");
  });

  describe("createSubWorktrees", () => {
    it("creates N sub-worktrees for each repo", async () => {
      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes("rev-parse HEAD")) return "abc123";
        if (cmd.includes("rev-parse --abbrev-ref HEAD")) return "feature/my-branch";
        if (cmd.includes("rev-parse --verify")) throw new Error("branch not found");
        if (cmd.includes("worktree add")) return "";
        return "";
      });

      const emitStatus = vi.fn();
      const result = await createSubWorktrees("my-ws", repos, 3, emitStatus);

      expect(result).toHaveLength(3);
      expect(result[0].label).toBe("candidate-1");
      expect(result[1].label).toBe("candidate-2");
      expect(result[2].label).toBe("candidate-3");

      // Each candidate has repos mapped
      for (const sub of result) {
        expect(sub.repoPaths.size).toBe(1);
        expect(sub.branchNames.size).toBe(1);
        expect(sub.repos).toHaveLength(1);
        expect(sub.repos[0].repoName).toBe("repo");
      }

      // Verify branch naming
      expect(result[0].branchNames.get("github.com/org/repo")).toBe(
        "feature/my-branch-bon-1",
      );
      expect(result[2].branchNames.get("github.com/org/repo")).toBe(
        "feature/my-branch-bon-3",
      );
    });

    it("emits status messages during creation", async () => {
      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes("rev-parse HEAD")) return "abc123";
        if (cmd.includes("rev-parse --abbrev-ref HEAD")) return "main";
        if (cmd.includes("rev-parse --verify")) throw new Error("not found");
        if (cmd.includes("worktree add")) return "";
        return "";
      });

      const emitStatus = vi.fn();
      await createSubWorktrees("my-ws", repos, 2, emitStatus);

      expect(emitStatus).toHaveBeenCalledWith(
        "[candidate-1] Creating sub-worktree for repo",
      );
      expect(emitStatus).toHaveBeenCalledWith(
        "[candidate-2] Creating sub-worktree for repo",
      );
    });

    it("sets candidate repo worktreePaths to sub-worktree paths", async () => {
      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes("rev-parse HEAD")) return "abc123";
        if (cmd.includes("rev-parse --abbrev-ref HEAD")) return "main";
        if (cmd.includes("rev-parse --verify")) throw new Error("not found");
        if (cmd.includes("worktree add")) return "";
        return "";
      });

      const result = await createSubWorktrees("my-ws", repos, 2, vi.fn());

      // Candidate repos should point to tmp/bon-N directories, not the original
      expect(result[0].repos[0].worktreePath).toContain("tmp/bon-1");
      expect(result[1].repos[0].worktreePath).toContain("tmp/bon-2");
    });
  });

  describe("getSubWorktreeDiff", () => {
    it("returns diff between base commit and HEAD", async () => {
      mockExec.mockReturnValue("diff --git a/file.ts b/file.ts\n+added line");
      const diff = await getSubWorktreeDiff("/tmp/sub-wt", "abc123");
      expect(diff).toContain("+added line");
      expect(mockExec).toHaveBeenCalledWith(
        'git -C "/tmp/sub-wt" diff "abc123"..HEAD',
      );
    });

    it("returns empty string on error", async () => {
      mockExec.mockImplementation(() => { throw new Error("no diff"); });
      const diff = await getSubWorktreeDiff("/tmp/sub-wt", "abc123");
      expect(diff).toBe("");
    });
  });

  describe("getBaseCommit", () => {
    it("returns merge-base of original and sub worktree", async () => {
      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes("merge-base")) return "base123";
        return "head123";
      });

      const base = await getBaseCommit("/tmp/orig", "/tmp/sub");
      expect(base).toBe("base123");
    });
  });

  describe("applySubWorktreeResult", () => {
    it("skips when no commits to apply", async () => {
      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes("rev-list --count")) return "0";
        return "";
      });

      await applySubWorktreeResult("/tmp/orig", "/tmp/sub", "base123");

      // Should not have called format-patch
      expect(mockExec).not.toHaveBeenCalledWith(
        expect.stringContaining("format-patch"),
      );
    });

    it("applies patches when commits exist", async () => {
      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes("rev-list --count")) return "2";
        return "";
      });

      await applySubWorktreeResult("/tmp/orig", "/tmp/sub", "base123");

      // Should have called format-patch and am
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("format-patch"),
      );
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("am"),
      );
    });
  });

  describe("cleanupSubWorktrees", () => {
    it("prunes worktrees and deletes branches", async () => {
      vi.mocked(pathExists).mockResolvedValue(true);

      const sub = {
        index: 0,
        label: "candidate-1",
        repoPaths: new Map([["github.com/org/repo", "/tmp/test-workspace/my-ws/tmp/bon-1/github.com/org/repo"]]),
        branchNames: new Map([["github.com/org/repo", "main-bon-1"]]),
        repos: repos,
      };

      const emitStatus = vi.fn();
      await cleanupSubWorktrees("my-ws", [sub], repos, emitStatus);

      expect(emitStatus).toHaveBeenCalledWith("Sub-worktrees cleaned up");
      // Should have called worktree prune
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("worktree prune"),
      );
      // Should have called branch -D
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("branch -D"),
      );
    });
  });
});
