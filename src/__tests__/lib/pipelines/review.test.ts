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
  parseAcceptanceCriteria: vi.fn(() => []),
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
  buildCrossRepositoryReviewerPrompt: vi.fn(() => "cross-repo-reviewer-prompt"),
  buildFixVerifierPrompt: vi.fn(() => "fix-verifier-prompt"),
}));

vi.mock("@/lib/workspace/review-baseline", () => ({
  captureRepoHead: vi.fn(() => "head0001"),
  readPreviousReviewBaseline: vi.fn(async () => null),
  writeReviewBaseline: vi.fn(async () => {}),
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
  buildNoConstraintsReport: vi.fn(() => "NOT-DECLARED-REPORT"),
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
import {
  execConstraintCommand,
  buildNoConstraintsReport,
} from "@/lib/workspace/constraint-runner";
import type { PhaseFunctionContext, PipelinePhaseFunction, PipelinePhaseGroup } from "@/types/pipeline";

import { getRepoChanges } from "@/lib/workspace";
import {
  buildCodeReviewerPrompt,
  buildFixVerifierPrompt,
  buildReadmeVerifierPrompt,
} from "@/lib/templates";
import {
  captureRepoHead,
  readPreviousReviewBaseline,
  writeReviewBaseline,
} from "@/lib/workspace/review-baseline";

const mockListWorkspaceRepos = vi.mocked(listWorkspaceRepos);
const mockParseConstraints = vi.mocked(parseConstraints);
const mockExecConstraintCommand = vi.mocked(execConstraintCommand);
const mockBuildNoConstraintsReport = vi.mocked(buildNoConstraintsReport);
const mockGetRepoChanges = vi.mocked(getRepoChanges);
const mockBuildCodeReviewerPrompt = vi.mocked(buildCodeReviewerPrompt);
const mockBuildFixVerifierPrompt = vi.mocked(buildFixVerifierPrompt);
const mockCaptureRepoHead = vi.mocked(captureRepoHead);
const mockReadPreviousBaseline = vi.mocked(readPreviousReviewBaseline);
const mockWriteReviewBaseline = vi.mocked(writeReviewBaseline);

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
    const groupPhase = phases[1] as PipelinePhaseGroup;
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
    const groupPhase = phases[1] as PipelinePhaseGroup;
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
    const groupPhase = phases[1] as PipelinePhaseGroup;
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
    const groupPhase = phases[1] as PipelinePhaseGroup;
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

describe("buildReviewPipeline — cross-repository review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileMap.clear();
  });

  function twoRepos() {
    return [
      {
        repoName: "api",
        repoPath: "owner/api",
        worktreePath: "/repos/api/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
      {
        repoName: "web",
        repoPath: "owner/web",
        worktreePath: "/repos/web/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ];
  }

  it("adds a cross-repository review child when the workspace has multiple repos and no repository filter", async () => {
    mockListWorkspaceRepos.mockReturnValue(twoRepos());

    const phases = await buildReviewPipeline({ workspace: "test-ws" });
    const groupPhase = phases[1] as PipelinePhaseGroup;
    const labels = groupPhase.children.map((c) => c.label);

    expect(labels).toContain("review-cross-repository");
  });

  it("puts the cross-repository review first so it is never the one queued", async () => {
    mockListWorkspaceRepos.mockReturnValue(twoRepos());

    const phases = await buildReviewPipeline({ workspace: "test-ws" });
    const groupPhase = phases[1] as PipelinePhaseGroup;
    const labels = groupPhase.children.map((c) => c.label);

    // The group runs behind a FIFO semaphore that starts children in array
    // order, so array position decides start order. This child is the longest
    // running one (it reads across every worktree) and is built last because it
    // needs each repo's diff, so appending it would reliably park the critical
    // path at the back of the queue.
    expect(labels[0]).toBe("review-cross-repository");
    expect(labels.length).toBeGreaterThan(1);
  });

  it("does NOT add a cross-repository review child for a single-repo workspace", async () => {
    mockListWorkspaceRepos.mockReturnValue([twoRepos()[0]]);

    const phases = await buildReviewPipeline({ workspace: "test-ws" });
    const groupPhase = phases[1] as PipelinePhaseGroup;
    const labels = groupPhase.children.map((c) => c.label);

    expect(labels).not.toContain("review-cross-repository");
  });

  it("does NOT add a cross-repository review child when a single repository is targeted", async () => {
    mockListWorkspaceRepos.mockReturnValue(twoRepos());

    const phases = await buildReviewPipeline({
      workspace: "test-ws",
      repository: "owner/api",
    });
    const groupPhase = phases[1] as PipelinePhaseGroup;
    const labels = groupPhase.children.map((c) => c.label);

    expect(labels).not.toContain("review-cross-repository");
    expect(labels).toContain("review-api");
    expect(labels).not.toContain("review-web");
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
    const verifyPhase = phases[0] as PipelinePhaseFunction;
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

// A repo with no declared constraints used to leave no CONSTRAINTS-* file at
// all, so the collector's constraint section read "(none)" and SUMMARY.md was
// silent — indistinguishable from "everything passed". Since the code reviewer
// no longer runs lint/test on its own initiative, nothing else covers the gap.
describe("buildReviewPipeline — repos without declared constraints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileMap.clear();
    mockBunWrite.mockClear();
    mockExecConstraintCommand.mockReset();
    mockBuildNoConstraintsReport.mockReturnValue("NOT-DECLARED-REPORT");
  });

  const reviewDir = "/ws/test-ws/artifacts/reviews/2026-04-08T00-00-00";

  it("writes a not-declared report per repo when the README declares no constraints at all", async () => {
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
    mockParseConstraints.mockReturnValue([]);

    const phases = await buildReviewPipeline({ workspace: "test-ws" });
    const verifyPhase = phases[0] as PipelinePhaseFunction;
    const ctx = createMockCtx();
    expect(await verifyPhase.fn(ctx)).toBe(true);

    expect(mockExecConstraintCommand).not.toHaveBeenCalled();
    expect(mockBuildNoConstraintsReport.mock.calls.map((c) => c[0])).toEqual([
      "repo-a",
      "repo-b",
    ]);
    expect(mockBunWrite).toHaveBeenCalledTimes(2);
    expect(mockBunWrite).toHaveBeenCalledWith(
      `${reviewDir}/CONSTRAINTS-owner_repo-a.md`,
      "NOT-DECLARED-REPORT",
    );
    expect(mockBunWrite).toHaveBeenCalledWith(
      `${reviewDir}/CONSTRAINTS-owner_repo-b.md`,
      "NOT-DECLARED-REPORT",
    );
  });

  it("does not report a not-declared repo as a constraint failure", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "repo-a",
        repoPath: "owner/repo-a",
        worktreePath: "/repos/repo-a/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);
    mockParseConstraints.mockReturnValue([]);

    const phases = await buildReviewPipeline({ workspace: "test-ws" });
    const ctx = createMockCtx();
    await (phases[0] as PipelinePhaseFunction).fn(ctx);

    const results = vi.mocked(ctx.emitResult).mock.calls.map((c) => c[0]);
    expect(results.some((m) => /failure/i.test(m))).toBe(false);
    expect(results.some((m) => /no constraints declared/i.test(m))).toBe(true);
  });

  it("covers only the undeclared repo in a workspace where another repo declares constraints", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "declared",
        repoPath: "owner/declared",
        worktreePath: "/repos/declared/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
      {
        repoName: "undeclared",
        repoPath: "owner/undeclared",
        worktreePath: "/repos/undeclared/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);
    mockParseConstraints.mockReturnValue([
      { repoName: "declared", constraints: [{ label: "Lint", command: "make lint" }] },
    ]);
    mockExecConstraintCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 10,
    });

    const phases = await buildReviewPipeline({ workspace: "test-ws" });
    const ctx = createMockCtx();
    await (phases[0] as PipelinePhaseFunction).fn(ctx);

    expect(mockExecConstraintCommand).toHaveBeenCalledTimes(1);
    expect(mockBuildNoConstraintsReport.mock.calls.map((c) => c[0])).toEqual([
      "undeclared",
    ]);
    expect(mockBunWrite).toHaveBeenCalledTimes(2);
  });
});

describe("buildReviewPipeline — incremental review scope", () => {
  const repo = {
    repoName: "repo-a",
    repoPath: "owner/repo-a",
    worktreePath: "/repos/repo-a/worktrees/test-ws",
  } as ReturnType<typeof listWorkspaceRepos>[number];

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileMap.clear();
    mockListWorkspaceRepos.mockReturnValue([repo]);
    mockReadPreviousBaseline.mockResolvedValue(null);
    mockCaptureRepoHead.mockReturnValue("head0001");
    mockGetRepoChanges.mockReturnValue({
      currentBranch: "feature/test",
      changedFiles: "",
      diffStat: "",
      commitLog: "",
    });
  });

  it("records this review's heads so the next review has a baseline", async () => {
    await buildReviewPipeline({ workspace: "test-ws" });
    expect(mockWriteReviewBaseline).toHaveBeenCalledWith(
      "/ws/test-ws",
      "2026-04-08T00-00-00",
      { "repo-a": "head0001" },
    );
  });

  it("omits a repo whose HEAD could not be read rather than recording a bogus one", async () => {
    mockCaptureRepoHead.mockReturnValue(null);
    await buildReviewPipeline({ workspace: "test-ws" });
    expect(mockWriteReviewBaseline).toHaveBeenCalledWith(
      "/ws/test-ws",
      "2026-04-08T00-00-00",
      {},
    );
  });

  it("asks for the diff since the previous baseline for that repo", async () => {
    mockReadPreviousBaseline.mockResolvedValue({
      timestamp: "20260101-000000",
      heads: { "repo-a": "old00001" },
    });

    await buildReviewPipeline({ workspace: "test-ws" });

    expect(mockGetRepoChanges).toHaveBeenCalledWith(
      "test-ws",
      "owner/repo-a",
      "main",
      "old00001",
    );
  });

  it("passes no baseline for a repo the previous review did not cover", async () => {
    mockReadPreviousBaseline.mockResolvedValue({
      timestamp: "20260101-000000",
      heads: { "other-repo": "old00001" },
    });

    await buildReviewPipeline({ workspace: "test-ws" });

    expect(mockGetRepoChanges).toHaveBeenCalledWith(
      "test-ws",
      "owner/repo-a",
      "main",
      undefined,
    );
  });

  it("hands the code reviewer a review scope tagged with the baseline session", async () => {
    mockReadPreviousBaseline.mockResolvedValue({
      timestamp: "20260101-000000",
      heads: { "repo-a": "old00001" },
    });
    mockGetRepoChanges.mockReturnValue({
      currentBranch: "feature/test",
      changedFiles: "M\tfull.ts",
      diffStat: "full",
      commitLog: "full log",
      incremental: {
        sinceSha: "old00001",
        changedFiles: "M\tinc.ts",
        diffStat: "inc",
        commitLog: "inc log",
        hasChanges: true,
      },
    });

    await buildReviewPipeline({ workspace: "test-ws" });

    expect(mockBuildCodeReviewerPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewScope: expect.objectContaining({
          sinceSha: "old00001",
          sinceTimestamp: "20260101-000000",
          changedFiles: "M\tinc.ts",
        }),
      }),
    );
  });

  // A baseline that git rejected (rebase, force-push) yields no incremental block,
  // and the reviewer must then get the whole branch rather than an empty target.
  it("leaves the review scope unset when the range was unusable", async () => {
    mockReadPreviousBaseline.mockResolvedValue({
      timestamp: "20260101-000000",
      heads: { "repo-a": "gone0001" },
    });

    await buildReviewPipeline({ workspace: "test-ws" });

    expect(mockBuildCodeReviewerPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ reviewScope: undefined }),
    );
  });
});

describe("buildReviewPipeline — requested-fix verifier", () => {
  const repo = {
    repoName: "repo-a",
    repoPath: "owner/repo-a",
    worktreePath: "/repos/repo-a/worktrees/test-ws",
  } as ReturnType<typeof listWorkspaceRepos>[number];

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileMap.clear();
    mockListWorkspaceRepos.mockReturnValue([repo]);
    mockReadPreviousBaseline.mockResolvedValue(null);
    mockCaptureRepoHead.mockReturnValue("head0001");
    mockGetRepoChanges.mockReturnValue({
      currentBranch: "feature/test",
      changedFiles: "",
      diffStat: "",
      commitLog: "",
    });
  });

  it("is absent on a run where no previous cycle asked for anything", async () => {
    const phases = await buildReviewPipeline({ workspace: "test-ws" });
    const labels = (phases[1] as PipelinePhaseGroup).children.map((c) => c.label);
    expect(labels).not.toContain("verify-fixes-repo-a");
  });

  it("is absent when the list is present but empty", async () => {
    const phases = await buildReviewPipeline({ workspace: "test-ws", requestedFixes: [] });
    const labels = (phases[1] as PipelinePhaseGroup).children.map((c) => c.label);
    expect(labels).not.toContain("verify-fixes-repo-a");
  });

  it("is added, alongside the code reviewer, when fixes were requested", async () => {
    const phases = await buildReviewPipeline({
      workspace: "test-ws",
      requestedFixes: ["gate the anchor on a defined href"],
    });
    const labels = (phases[1] as PipelinePhaseGroup).children.map((c) => c.label);
    expect(labels).toContain("verify-fixes-repo-a");
    expect(labels).toContain("review-repo-a");
  });

  it("gives the verifier the asks verbatim and its own report file", async () => {
    await buildReviewPipeline({
      workspace: "test-ws",
      requestedFixes: ["fix one", "fix two"],
    });

    expect(mockBuildFixVerifierPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedFixes: ["fix one", "fix two"],
        verifyFilePath: expect.stringContaining("VERIFY-FIXES-owner_repo-a.md"),
      }),
    );
  });
});

describe("buildReviewPipeline — phase order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileMap.clear();
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "repo-a",
        repoPath: "owner/repo-a",
        worktreePath: "/repos/repo-a/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);
  });

  it("runs constraints before the reviewer group so the report is on disk for it", async () => {
    const phases = await buildReviewPipeline({ workspace: "test-ws" });
    expect((phases[0] as PipelinePhaseFunction).label).toBe("Verify constraints");
    expect(phases[1].kind).toBe("group");
    expect((phases[2] as PipelinePhaseFunction).label).toBe("Collect review results");
  });

  it("points the README verifier at the constraint report instead of the commands", async () => {
    await buildReviewPipeline({ workspace: "test-ws" });
    expect(vi.mocked(buildReadmeVerifierPrompt)).toHaveBeenCalledWith(
      expect.objectContaining({
        constraintReportPath: expect.stringContaining("CONSTRAINTS-owner_repo-a.md"),
      }),
    );
  });
});

// A fix round is reviewed like any other round: the fix diff gets the same
// defect hunt an execute diff gets. Narrowing happens through the incremental
// baseline, never by dropping reviewers.
describe("buildReviewPipeline — a round with requested fixes keeps every reviewer", () => {
  const repo = {
    repoName: "repo-a",
    repoPath: "owner/repo-a",
    worktreePath: "/repos/repo-a/worktrees/test-ws",
  } as ReturnType<typeof listWorkspaceRepos>[number];

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileMap.clear();
    mockListWorkspaceRepos.mockReturnValue([repo]);
    mockFileMap.set("/ws/test-ws/TODO-repo-a.md", "- [ ] something");
  });

  it("keeps the code reviewer and the TODO verifier next to the fix verifier", async () => {
    const phases = await buildReviewPipeline({
      workspace: "test-ws",
      requestedFixes: ["fix one"],
    });
    const labels = (phases[1] as PipelinePhaseGroup).children.map((c) => c.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "verify-fixes-repo-a",
        "verify-readme-repo-a",
        "review-repo-a",
        "verify-todo-repo-a",
      ]),
    );
  });

  it("keeps the cross-repository reviewer", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      repo,
      {
        repoName: "repo-b",
        repoPath: "owner/repo-b",
        worktreePath: "/repos/repo-b/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);
    const phases = await buildReviewPipeline({
      workspace: "test-ws",
      requestedFixes: ["fix one"],
    });
    const labels = (phases[1] as PipelinePhaseGroup).children.map((c) => c.label);
    expect(labels).toContain("review-cross-repository");
  });
});
