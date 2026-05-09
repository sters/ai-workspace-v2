import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/ws",
}));

vi.mock("@/lib/workspace/reader", () => ({
  getReadme: vi.fn(async () => ""),
}));

vi.mock("@/lib/parsers/readme", () => ({
  parseReadmeMeta: vi.fn(() => ({ repositories: [] })),
  parseConstraints: vi.fn(() => []),
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

vi.mock("@/lib/workspace/constraint-runner", () => ({
  execConstraintCommand: vi.fn(),
  buildConstraintReport: vi.fn(() => ""),
}));

vi.mock("@/lib/env", () => ({
  getCleanEnv: vi.fn(() => ({})),
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

const originalBunWrite = Bun.write;
const mockBunWrite = vi.fn(async () => 0);
Bun.write = mockBunWrite as unknown as typeof Bun.write;

afterAll(() => {
  Bun.file = originalBunFile;
  Bun.write = originalBunWrite;
});

import { buildReviewPipeline } from "@/lib/pipelines/review";
import { listWorkspaceRepos } from "@/lib/workspace";
import { parseConstraints } from "@/lib/parsers/readme";
import { execConstraintCommand } from "@/lib/workspace/constraint-runner";
import type { PhaseFunctionContext, PipelinePhaseFunction, PipelinePhaseGroup } from "@/types/pipeline";

const mockListWorkspaceRepos = vi.mocked(listWorkspaceRepos);
const mockParseConstraints = vi.mocked(parseConstraints);
const mockExecConstraintCommand = vi.mocked(execConstraintCommand);

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

describe("buildReviewPipeline — constraint timeout aborts remaining commands in same repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileMap.clear();
    mockBunWrite.mockClear();
    mockExecConstraintCommand.mockReset();
  });

  it("stops running further constraints in the same repo on first timeout, but continues with other repos", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "repo-a",
        repoPath: "owner/repo-a",
        worktreePath: "/repos/repo-a/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
      {
        repoName: "repo-b",
        repoPath: "owner/repo-b",
        worktreePath: "/repos/repo-b/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);

    mockParseConstraints.mockReturnValue([
      {
        repoName: "repo-a",
        constraints: [
          { label: "Build", command: "make hydrate" },
          { label: "Validate", command: "make validate" },
        ],
      },
      {
        repoName: "repo-b",
        constraints: [
          { label: "Build", command: "make hydrate" },
          { label: "Validate", command: "make validate" },
        ],
      },
    ]);

    // First call (repo-a/Build) → timeout. Subsequent calls → success.
    mockExecConstraintCommand.mockImplementation(async (command: string) => {
      if (command === "make hydrate" && mockExecConstraintCommand.mock.calls.length === 1) {
        return { exitCode: null, stdout: "", stderr: "", timedOut: true, durationMs: 300003 };
      }
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 100 };
    });

    const phases = await buildReviewPipeline({ workspace: "test-ws" });
    const verifyPhase = phases[1] as PipelinePhaseFunction;
    expect(verifyPhase.kind).toBe("function");
    expect(verifyPhase.label).toBe("Verify constraints");

    const ctx = createMockCtx();
    const result = await verifyPhase.fn(ctx);
    expect(result).toBe(true);

    // repo-a/Build (timeout) + repo-b/Build + repo-b/Validate = 3 calls.
    // repo-a/Validate must be skipped.
    expect(mockExecConstraintCommand).toHaveBeenCalledTimes(3);
    expect(mockExecConstraintCommand.mock.calls[0][0]).toBe("make hydrate");
    expect(mockExecConstraintCommand.mock.calls[0][1]).toMatchObject({
      cwd: "/repos/repo-a/worktrees/test-ws",
    });
    expect(mockExecConstraintCommand.mock.calls[1][1]).toMatchObject({
      cwd: "/repos/repo-b/worktrees/test-ws",
    });
    expect(mockExecConstraintCommand.mock.calls[2][1]).toMatchObject({
      cwd: "/repos/repo-b/worktrees/test-ws",
    });

    // Both repo reports should still be written (partial for repo-a, full for repo-b).
    expect(mockBunWrite).toHaveBeenCalledTimes(2);

    // anyFailure → "Constraint verification completed with failures"
    expect(ctx.emitResult).toHaveBeenCalledWith("Constraint verification completed with failures");

    // Status should mention skipping remaining constraints for the timed-out repo.
    const statusMessages = vi.mocked(ctx.emitStatus).mock.calls.map((c) => c[0]);
    expect(
      statusMessages.some(
        (m) => m.includes("repo-a") && /skip/i.test(m) && /timeout|timed out/i.test(m),
      ),
    ).toBe(true);
  });
});
