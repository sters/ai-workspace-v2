import { vi, describe, it, expect, beforeEach } from "vitest";
import { buildInitFromPrPipeline } from "@/lib/pipelines/init-from-pr";
import { extractPrUrls, resolvePrBranch } from "@/lib/workspace/pr-url";
import { setupRepository } from "@/lib/pipelines/actions/setup-repository";
import { setupWorkspace } from "@/lib/workspace";
import { exec } from "@/lib/workspace/helpers";
import type { PhaseFunctionContext, PipelinePhase } from "@/types/pipeline";

vi.mock("@/lib/parsers/readme", () => ({
  readWorkspaceReadme: vi.fn(),
  denormalizeRepoPath: vi.fn((p: string) => p),
}));
vi.mock("@/lib/workspace", () => ({
  parseAnalysisResultText: vi.fn(() => ({
    taskType: "feature",
    slug: "from-pr",
    ticketId: "",
    repositories: [],
  })),
  setupWorkspace: vi.fn(async () => ({
    workspaceName: "feature-from-pr-20260624",
    workspacePath: "/ws/feature-from-pr-20260624",
  })),
  commitWorkspaceSnapshot: vi.fn(),
  writeTodoTemplate: vi.fn(),
  writeReportTemplates: vi.fn(),
  listWorkspaceRepos: vi.fn(() => []),
}));
vi.mock("@/lib/workspace/pr-url", () => ({
  extractPrUrls: vi.fn(),
  resolvePrBranch: vi.fn(),
}));
vi.mock("@/lib/workspace/helpers", () => ({
  exec: vi.fn(() => JSON.stringify({ title: "My PR", body: "Body", number: 123 })),
}));
vi.mock("@/lib/pipelines/actions/setup-repository", () => ({
  setupRepository: vi.fn(() => ({
    repoPath: "github.com/org/repo",
    repoName: "repo",
    worktreePath: "/ws/feature-from-pr-20260624/github.com/org/repo",
    baseBranch: "main",
    branchName: "feature/my-branch",
  })),
}));
vi.mock("@/lib/templates", () => ({
  buildReadmeContent: vi.fn(() => "# Task: TBD"),
  buildInitAnalyzeAndReadmePrompt: vi.fn(() => "prompt"),
  INIT_ANALYSIS_SCHEMA: {},
  buildPlannerPrompt: vi.fn(() => "planner-prompt"),
  buildCoordinatorPrompt: vi.fn(() => "coordinator-prompt"),
  buildReviewerPrompt: vi.fn(() => "reviewer-prompt"),
  buildBestOfNFileReviewerPrompt: vi.fn(() => "reviewer-prompt"),
  BEST_OF_N_REVIEW_SCHEMA: {},
}));
vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/file.md"),
  ensureGlobalSystemPrompt: vi.fn(() => "/mock/prompts/global.md"),
}));

function makeCtx(overrides: Partial<PhaseFunctionContext> = {}): PhaseFunctionContext {
  return {
    operationId: "op-1",
    emitStatus: vi.fn(),
    emitResult: vi.fn(),
    emitAsk: vi.fn(),
    setWorkspace: vi.fn(),
    runChild: vi.fn(async () => true),
    runChildGroup: vi.fn(async () => [true]),
    emitTerminal: vi.fn(),
    appendPhases: vi.fn(),
    signal: new AbortController().signal,
    ...overrides,
  } as unknown as PhaseFunctionContext;
}

function labelsOf(phases: PipelinePhase[]): string[] {
  return phases.map((p) => (p.kind === "function" || p.kind === "single" ? p.label : "group"));
}

describe("buildInitFromPrPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Bun, "write").mockResolvedValue(0);
    vi.mocked(extractPrUrls).mockReturnValue([
      {
        url: "https://github.com/org/repo/pull/123",
        owner: "org",
        repo: "repo",
        repoPath: "github.com/org/repo",
        prNumber: 123,
      },
    ]);
    vi.mocked(resolvePrBranch).mockReturnValue({
      headBranch: "feature/my-branch",
      baseBranch: "main",
      repoPath: "github.com/org/repo",
      prUrl: "https://github.com/org/repo/pull/123",
      isFork: false,
    });
    vi.mocked(exec).mockReturnValue(
      JSON.stringify({ title: "My PR", body: "Body", number: 123 }),
    );
  });

  it("returns the three core phases by default and stops after worktree setup", () => {
    const phases = buildInitFromPrPipeline("https://github.com/org/repo/pull/123");
    expect(labelsOf(phases)).toEqual([
      "Verify PR",
      "Analyze PR & draft README",
      "Setup workspace",
    ]);
  });

  it("appends TODO-planning phases when todoInstruction is provided", () => {
    const phases = buildInitFromPrPipeline("https://github.com/org/repo/pull/123", {
      todoInstruction: "Plan TODOs for the changed endpoints",
    });
    expect(labelsOf(phases)).toContain("Plan TODO items");
    expect(labelsOf(phases)).toContain("Commit snapshot");
  });

  it("does not append TODO phases when todoInstruction is empty/whitespace", () => {
    const phases = buildInitFromPrPipeline("https://github.com/org/repo/pull/123", {
      todoInstruction: "   ",
    });
    expect(labelsOf(phases)).not.toContain("Plan TODO items");
  });

  it("appends a Review phase when withReview is set", () => {
    const phases = buildInitFromPrPipeline("https://github.com/org/repo/pull/123", {
      withReview: true,
    });
    expect(labelsOf(phases)).toContain("Review");
  });

  it("returns a new array each call", () => {
    const a = buildInitFromPrPipeline("https://github.com/org/repo/pull/1");
    const b = buildInitFromPrPipeline("https://github.com/org/repo/pull/2");
    expect(a).not.toBe(b);
  });

  it("Verify PR fails when no PR URL is present", async () => {
    vi.mocked(extractPrUrls).mockReturnValue([]);
    const phases = buildInitFromPrPipeline("not a url");
    const verify = phases[0];
    if (verify.kind !== "function") throw new Error("expected function phase");
    const ctx = makeCtx();
    const ok = await verify.fn(ctx);
    expect(ok).toBe(false);
    expect(ctx.emitResult).toHaveBeenCalled();
  });

  it("Verify PR rejects fork PRs (fork support is out of scope)", async () => {
    vi.mocked(resolvePrBranch).mockReturnValue({
      headBranch: "feature/forked",
      baseBranch: "main",
      repoPath: "github.com/org/repo",
      prUrl: "https://github.com/org/repo/pull/123",
      isFork: true,
    });
    const phases = buildInitFromPrPipeline("https://github.com/org/repo/pull/123");
    const verify = phases[0];
    if (verify.kind !== "function") throw new Error("expected function phase");
    const ctx = makeCtx();
    const ok = await verify.fn(ctx);
    expect(ok).toBe(false);
  });

  it("Setup workspace checks out the PR head branch (not a new branch)", async () => {
    const phases = buildInitFromPrPipeline("https://github.com/org/repo/pull/123");
    const ctx = makeCtx();
    // Run the three phases in order so shared closure state is populated.
    for (const phase of phases) {
      if (phase.kind !== "function") throw new Error("expected function phase");
      const ok = await phase.fn(ctx);
      expect(ok).toBe(true);
    }
    expect(setupWorkspace).toHaveBeenCalled();
    expect(setupRepository).toHaveBeenCalledWith(
      expect.any(String),
      "github.com/org/repo",
      "main", // base branch from the PR
      expect.any(Function),
      "feature/my-branch", // checkoutBranch === PR head branch
    );
    expect(ctx.setWorkspace).toHaveBeenCalledWith("feature-from-pr-20260624");
  });
});
