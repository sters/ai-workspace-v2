import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/ws",
}));

vi.mock("@/lib/workspace/reader", () => ({
  getReadme: vi.fn(async () => ""),
}));

vi.mock("@/lib/parsers/readme", () => ({
  parseReadmeMeta: vi.fn(() => ({ repositories: [] })),
}));

vi.mock("@/lib/workspace", () => ({
  listWorkspaceRepos: vi.fn(),
  detectBaseBranch: vi.fn(() => "main"),
  getRepoChanges: vi.fn(() => ({
    currentBranch: "feature/test",
    changedFiles: "",
    diffStat: "",
    commitLog: "",
  })),
  prepareReviewDir: vi.fn(() => "2026-04-08T00-00-00"),
  writeReportTemplates: vi.fn(async () => {}),
}));

vi.mock("@/lib/templates", () => ({
  buildCodeReviewerPrompt: vi.fn(() => "code-reviewer-prompt"),
  buildTodoVerifierPrompt: vi.fn(() => "todo-verifier-prompt"),
  buildReadmeVerifierPrompt: vi.fn(() => "readme-verifier-prompt"),
  buildCollectorPrompt: vi.fn(() => "collector-prompt"),
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/agent.md"),
}));

vi.mock("@/lib/pipeline-manager", () => ({
  getTimeoutDefaults: vi.fn(() => ({ claudeMs: 60_000, functionMs: 30_000 })),
}));

// Mock Bun.file with a per-path map so we can simulate per-repo TODO files
const mockFileMap = new Map<string, string | null>();
const originalBunFile = Bun.file;
Bun.file = vi.fn((p: string | URL) => {
  const key = typeof p === "string" ? p : p.toString();
  const content = mockFileMap.get(key);
  return {
    exists: async () => content !== undefined && content !== null,
    text: async () => content ?? "",
  };
}) as unknown as typeof Bun.file;

afterAll(() => {
  Bun.file = originalBunFile;
});

import { buildReviewPipeline } from "@/lib/pipelines/review";
import { listWorkspaceRepos } from "@/lib/workspace";
import type { PipelinePhaseGroup } from "@/types/pipeline";

const mockListWorkspaceRepos = vi.mocked(listWorkspaceRepos);

describe("buildReviewPipeline — skip verify-todo when TODO file is missing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileMap.clear();
  });

  it("does NOT include a verify-todo child when the repo has no TODO file", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "no-todo-repo",
        repoPath: "owner/no-todo-repo",
        worktreePath: "/repos/no-todo-repo/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);
    // No entry in mockFileMap → file doesn't exist

    const phases = await buildReviewPipeline({ workspace: "test-ws" });
    const groupPhase = phases[0] as PipelinePhaseGroup;
    expect(groupPhase.kind).toBe("group");

    const labels = groupPhase.children.map((c) => c.label);
    expect(labels).toContain("review-no-todo-repo");
    expect(labels).toContain("verify-readme-no-todo-repo");
    expect(labels).not.toContain("verify-todo-no-todo-repo");
  });

  it("does NOT include a verify-todo child when the TODO file exists but is empty", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "empty-todo-repo",
        repoPath: "owner/empty-todo-repo",
        worktreePath: "/repos/empty-todo-repo/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);
    mockFileMap.set("/ws/test-ws/TODO-empty-todo-repo.md", "   \n\n  ");

    const phases = await buildReviewPipeline({ workspace: "test-ws" });
    const groupPhase = phases[0] as PipelinePhaseGroup;
    const labels = groupPhase.children.map((c) => c.label);
    expect(labels).not.toContain("verify-todo-empty-todo-repo");
  });

  it("DOES include a verify-todo child when the TODO file has content", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "active-repo",
        repoPath: "owner/active-repo",
        worktreePath: "/repos/active-repo/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);
    mockFileMap.set(
      "/ws/test-ws/TODO-active-repo.md",
      "# TODO\n\n- [x] done task\n",
    );

    const phases = await buildReviewPipeline({ workspace: "test-ws" });
    const groupPhase = phases[0] as PipelinePhaseGroup;
    const labels = groupPhase.children.map((c) => c.label);
    expect(labels).toContain("verify-todo-active-repo");
  });

  it("skips verify-todo only for repos missing a TODO file in a multi-repo workspace", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "no-todo-repo",
        repoPath: "owner/no-todo-repo",
        worktreePath: "/repos/no-todo-repo/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
      {
        repoName: "active-repo",
        repoPath: "owner/active-repo",
        worktreePath: "/repos/active-repo/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);
    mockFileMap.set(
      "/ws/test-ws/TODO-active-repo.md",
      "# TODO\n\n- [ ] do this\n",
    );

    const phases = await buildReviewPipeline({ workspace: "test-ws" });
    const groupPhase = phases[0] as PipelinePhaseGroup;
    const labels = groupPhase.children.map((c) => c.label);

    expect(labels).not.toContain("verify-todo-no-todo-repo");
    expect(labels).toContain("verify-todo-active-repo");
    // Code reviews and README verifiers run for both repos regardless
    expect(labels).toContain("review-no-todo-repo");
    expect(labels).toContain("review-active-repo");
    expect(labels).toContain("verify-readme-no-todo-repo");
    expect(labels).toContain("verify-readme-active-repo");
  });
});
