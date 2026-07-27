import { vi, describe, it, expect, beforeEach } from "vitest";
import type { PipelinePhase, PhaseFunctionContext } from "@/types/pipeline";

vi.mock("@/lib/pipeline-manager", () => ({
  getOperation: vi.fn(),
}));
vi.mock("@/lib/config", () => ({
  getResolvedWorkspaceRoot: () => "/mock/workspace-root",
  getWorkspaceDir: () => "/mock/workspace-root/workspace",
  getConfig: vi.fn(() => ({
    operations: { bestOfN: 0, defaultInteractionLevel: "mid", typeOverrides: {} },
  })),
  getOperationConfig: vi.fn(() => ({
    bestOfN: 0,
    claudeTimeoutMinutes: 20,
    functionTimeoutMinutes: 3,
    defaultInteractionLevel: "mid",
  })),
}));
vi.mock("@/lib/workspace/reader", () => ({
  getReviewSessions: vi.fn(() => []),
  getReviewDetail: vi.fn(() => null),
  getTodos: vi.fn(() => []),
  getReadme: vi.fn(() => "# Test README"),
}));
vi.mock("@/lib/pipelines/init", () => ({
  buildInitPipeline: vi.fn(() => []),
}));
vi.mock("@/lib/pipelines/execute", () => ({
  buildExecutePipeline: vi.fn(async () => []),
}));
vi.mock("@/lib/pipelines/review", () => ({
  buildReviewPipeline: vi.fn(async () => []),
}));
vi.mock("@/lib/pipelines/create-pr", () => ({
  buildCreatePrPipeline: vi.fn(async () => []),
}));
vi.mock("@/lib/pipelines/update-todo", () => ({
  buildUpdateTodoPipeline: vi.fn(async () => []),
}));
vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/file.md"),
  ensureGlobalSystemPrompt: vi.fn(() => "/mock/prompts/global.md"),
}));
vi.mock("@/lib/workspace/todo-cleanup", () => ({
  stripCompletedTodosFromWorkspace: vi.fn(async () => []),
}));
vi.mock("@/lib/workspace/git", () => ({
  listWorkspaceRepos: vi.fn(() => [
    { repoPath: "github.com/sters/repo", repoName: "repo", worktreePath: "/x" },
  ]),
}));
vi.mock("@/lib/parsers/readme", () => ({
  readWorkspaceReadme: vi.fn(async () => ({
    content: "",
    meta: { title: "t", taskType: "feature", ticketId: "", date: "", repositories: [] },
  })),
  denormalizeRepoPath: (s: string) => s.replace("___", ":"),
  parseAcceptanceCriteria: vi.fn(() => []),
}));
vi.mock("@/lib/pipelines/actions/setup-repository", () => ({
  setupRepository: vi.fn(() => ({
    repoPath: "github.com/sters/repo",
    repoName: "repo",
    worktreePath: "/x",
    baseBranch: "main",
    branchName: "feature-x",
  })),
}));
vi.mock("@/lib/pipelines/actions/init-todo-analysis", () => ({
  buildInitTodoAnalysisPhases: vi.fn(() => []),
}));

import { buildAutonomousPipeline } from "@/lib/pipelines/autonomous";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { readWorkspaceReadme } from "@/lib/parsers/readme";
import { setupRepository } from "@/lib/pipelines/actions/setup-repository";
import { buildInitTodoAnalysisPhases } from "@/lib/pipelines/actions/init-todo-analysis";
import { getTodos } from "@/lib/workspace/reader";
import { buildInitPipeline } from "@/lib/pipelines/init";
import { buildUpdateTodoPipeline } from "@/lib/pipelines/update-todo";
import { buildExecutePipeline } from "@/lib/pipelines/execute";
import { buildReviewPipeline } from "@/lib/pipelines/review";
import { buildCreatePrPipeline } from "@/lib/pipelines/create-pr";
import { getOperation } from "@/lib/pipeline-manager";
import { getReviewSessions, getReviewDetail } from "@/lib/workspace/reader";
import { stripCompletedTodosFromWorkspace } from "@/lib/workspace/todo-cleanup";

const mockGetOperation = vi.mocked(getOperation);
const mockGetReviewDetail = vi.mocked(getReviewDetail);
const mockBuildInit = vi.mocked(buildInitPipeline);
const mockBuildUpdateTodo = vi.mocked(buildUpdateTodoPipeline);
const mockBuildExecute = vi.mocked(buildExecutePipeline);
const mockBuildReview = vi.mocked(buildReviewPipeline);
const mockBuildCreatePr = vi.mocked(buildCreatePrPipeline);
const mockGetReviewSessions = vi.mocked(getReviewSessions);
const mockStripCompletedTodos = vi.mocked(stripCompletedTodosFromWorkspace);
const mockListWorkspaceRepos = vi.mocked(listWorkspaceRepos);
const mockReadWorkspaceReadme = vi.mocked(readWorkspaceReadme);
const mockSetupRepository = vi.mocked(setupRepository);
const mockBuildInitTodoAnalysis = vi.mocked(buildInitTodoAnalysisPhases);
const mockGetTodos = vi.mocked(getTodos);

function createMockCtx(overrides?: Partial<PhaseFunctionContext>): PhaseFunctionContext {
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
    ...overrides,
  };
}

describe("buildAutonomousPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOperation.mockReturnValue({
      id: "test-op",
      type: "autonomous",
      workspace: "test-ws",
      status: "running",
      startedAt: new Date().toISOString(),
    });
    mockBuildInit.mockReturnValue([]);
    mockBuildUpdateTodo.mockResolvedValue([]);
    mockBuildExecute.mockResolvedValue([]);
    mockBuildReview.mockResolvedValue([]);
    mockBuildCreatePr.mockResolvedValue([]);
    mockGetReviewSessions.mockResolvedValue([]);
    mockListWorkspaceRepos.mockReturnValue([
      { repoPath: "github.com/sters/repo", repoName: "repo", worktreePath: "/x" },
    ]);
    mockReadWorkspaceReadme.mockResolvedValue({
      content: "",
      meta: { title: "t", taskType: "feature", ticketId: "", date: "", repositories: [] },
    });
    mockGetTodos.mockResolvedValue([
      { repoName: "repo", filename: "TODO-repo.md", total: 1, done: 0, blocked: 0, inProgress: 0 },
    ]);
    mockBuildInitTodoAnalysis.mockReturnValue([]);
  });

  describe("phase structure", () => {
    it("includes init phases when startWith is init", () => {
      const phases = buildAutonomousPipeline({
        startWith: "init",
        description: "Test description",
      });
      expect(mockBuildInit).toHaveBeenCalledWith("Test description", undefined);
      // init phases + Cycle 1 phase
      expect(phases.length).toBeGreaterThanOrEqual(1);
    });

    it("includes update-todo phase when startWith is update-todo", () => {
      const phases = buildAutonomousPipeline({
        startWith: "update-todo",
        workspace: "test-ws",
        instruction: "fix things",
      });
      // Ensure repositories + Ensure TODOs + update-todo + Cycle 1 (Execute, Review, Gate)
      expect(phases).toHaveLength(6);
      expect(phases.map((p) => p.kind === "function" && p.label)).toEqual([
        "Ensure repositories",
        "Ensure TODOs",
        "Update TODOs",
        "Cycle 1: Execute",
        "Cycle 1: Review",
        "Cycle 1: Gate",
      ]);
    });

    it("strips completed TODOs before the leading Update TODOs phase", async () => {
      const phases = buildAutonomousPipeline({
        startWith: "update-todo",
        workspace: "test-ws",
        instruction: "fix things",
      });
      const updatePhase = phases[2];
      if (updatePhase.kind !== "function") return;

      const ctx = createMockCtx();
      await updatePhase.fn(ctx);

      expect(mockStripCompletedTodos).toHaveBeenCalledWith("test-ws", undefined);
      expect(mockBuildUpdateTodo).toHaveBeenCalled();
    });

    it("has 5 phases (Ensure repos, Ensure TODOs, Execute, Review, Gate) when startWith is execute", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      expect(phases).toHaveLength(5);
      expect(phases.map((p) => p.kind === "function" && p.label)).toEqual([
        "Ensure repositories",
        "Ensure TODOs",
        "Cycle 1: Execute",
        "Cycle 1: Review",
        "Cycle 1: Gate",
      ]);
    });

    it("does not include salvage phases when startWith is init", () => {
      const phases = buildAutonomousPipeline({
        startWith: "init",
        description: "Test description",
      });
      const labels = phases.map((p) => p.kind === "function" && p.label);
      expect(labels).not.toContain("Ensure repositories");
      expect(labels).not.toContain("Ensure TODOs");
    });

    it("gates the first cycle behind a README clarity check when startWith is init", () => {
      mockBuildInit.mockReturnValue([]);
      const phases = buildAutonomousPipeline({
        startWith: "init",
        description: "Test description",
      });
      const labels = phases.map((p) => p.kind === "function" && p.label);
      // Cycle 1 is NOT queued upfront — the clarity gate appends it after the README is drafted.
      expect(labels).toContain("Analyze README clarity");
      expect(labels).not.toContain("Cycle 1: Execute");
    });
  });

  describe("README clarity gate", () => {
    function getClarityGatePhase() {
      mockBuildInit.mockReturnValue([]);
      const phases = buildAutonomousPipeline({
        startWith: "init",
        description: "Test description",
      });
      const phase = phases.find((p) => p.kind === "function" && p.label === "Analyze README clarity");
      if (!phase || phase.kind !== "function") throw new Error("clarity gate phase not found");
      return phase;
    }

    it("appends Cycle 1 when the README is judged sufficient", async () => {
      const phase = getClarityGatePhase();
      const appended: PipelinePhase[] = [];
      const ctx = createMockCtx({
        appendPhases: vi.fn((p: PipelinePhase[]) => { appended.push(...p); }),
        runChild: vi.fn(async (label, _prompt, opts) => {
          if (opts?.onResultText && label === "README Clarity Gate") {
            opts.onResultText(JSON.stringify({ sufficient: true, reason: "clear", missing: [] }));
          }
          return true;
        }),
      });
      const result = await phase.fn(ctx);

      expect(result).toBe(true);
      expect(appended.map((p) => p.kind === "function" && p.label)).toEqual([
        "Cycle 1: Execute",
        "Cycle 1: Review",
        "Cycle 1: Gate",
      ]);
    });

    it("stops and recommends refining the README when judged insufficient", async () => {
      const phase = getClarityGatePhase();
      const appended: PipelinePhase[] = [];
      const ctx = createMockCtx({
        appendPhases: vi.fn((p: PipelinePhase[]) => { appended.push(...p); }),
        runChild: vi.fn(async (label, _prompt, opts) => {
          if (opts?.onResultText && label === "README Clarity Gate") {
            opts.onResultText(JSON.stringify({
              sufficient: false,
              reason: "Goal is a placeholder",
              missing: ["Concrete goal", "At least one auto acceptance criterion"],
            }));
          }
          return true;
        }),
      });
      const result = await phase.fn(ctx);

      // Graceful stop: no cycle phases appended, run ends without touching code.
      expect(result).toBe(true);
      expect(appended).toHaveLength(0);
      expect(ctx.emitResult).toHaveBeenCalledWith(expect.stringContaining("too unclear"));
      expect(ctx.emitResult).toHaveBeenCalledWith(expect.stringContaining("update-readme"));
    });

    it("fails open (proceeds) when the clarity judge returns no verdict", async () => {
      const phase = getClarityGatePhase();
      const appended: PipelinePhase[] = [];
      const ctx = createMockCtx({
        appendPhases: vi.fn((p: PipelinePhase[]) => { appended.push(...p); }),
        // default runChild returns true but never calls onResultText → empty verdict
      });
      const result = await phase.fn(ctx);

      expect(result).toBe(true);
      expect(appended.map((p) => p.kind === "function" && p.label)).toEqual([
        "Cycle 1: Execute",
        "Cycle 1: Review",
        "Cycle 1: Gate",
      ]);
    });
  });

  describe("cycle phases", () => {
    it("execute phase runs buildExecutePipeline", async () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const execPhase = phases[2];
      if (execPhase.kind !== "function") return;

      const ctx = createMockCtx();
      await execPhase.fn(ctx);

      expect(mockBuildExecute).toHaveBeenCalled();
    });

    it("review phase runs buildReviewPipeline", async () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const reviewPhase = phases[3];
      if (reviewPhase.kind !== "function") return;

      const ctx = createMockCtx();
      await reviewPhase.fn(ctx);

      expect(mockBuildReview).toHaveBeenCalled();
    });

    it("gate phase appends create-pr when no critical issues", async () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const gatePhase = phases[4];
      if (gatePhase.kind !== "function") return;

      const appendedPhases: PipelinePhase[] = [];
      const ctx = createMockCtx({
        appendPhases: vi.fn((p: PipelinePhase[]) => { appendedPhases.push(...p); }),
      });
      await gatePhase.fn(ctx);

      // Gate returned shouldLoop: false (no review sessions) → appends Create PR
      expect(appendedPhases).toHaveLength(1);
      expect(appendedPhases[0].kind).toBe("function");
      if (appendedPhases[0].kind === "function") {
        expect(appendedPhases[0].label).toBe("Create PR");
      }
    });

    it("sets per-step timeouts", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      expect(phases[2].kind === "function" && phases[2].timeoutMs).toBe(70 * 60 * 1000);
      expect(phases[3].kind === "function" && phases[3].timeoutMs).toBe(45 * 60 * 1000);
      expect(phases[4].kind === "function" && phases[4].timeoutMs).toBe(10 * 60 * 1000);
    });

    // `runSubPhases` ignores each sub-phase's own `timeoutMs`, so the whole
    // sub-pipeline runs under the wrapping cycle phase's single budget. A
    // wrapper tighter than the pipeline it wraps fires first, and a timed-out
    // phase is then retried on the same budget — so it times out again.
    it("gives each cycle phase a budget covering its whole sub-pipeline", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const budgetOf = (label: string) => {
        const phase = phases.find((p) => p.kind === "function" && p.label === label);
        return phase?.kind === "function" ? phase.timeoutMs : undefined;
      };

      // execute.ts budgets `maxBatches * 20min + 5min`; 3 batches is routine.
      expect(budgetOf("Cycle 1: Execute")).toBeGreaterThanOrEqual(
        3 * 20 * 60 * 1000 + 5 * 60 * 1000,
      );
      // review.ts: parallel reviewer group + constraints (10min) + collect (20min).
      expect(budgetOf("Cycle 1: Review")).toBeGreaterThanOrEqual(
        (10 + 20 + 10) * 60 * 1000,
      );
    });

    it("returns false when no workspace is found", async () => {
      mockGetOperation.mockReturnValue(undefined);

      const phases = buildAutonomousPipeline({
        startWith: "execute",
      });
      const execPhase = phases[2];
      if (execPhase.kind !== "function") return;

      const ctx = createMockCtx();
      const result = await execPhase.fn(ctx);

      expect(result).toBe(false);
      expect(ctx.emitStatus).toHaveBeenCalledWith(
        expect.stringContaining("No workspace found"),
      );
    });

    it("gate appends Update TODO + next cycle when shouldLoop is true", async () => {
      mockGetReviewSessions.mockResolvedValue([{
        timestamp: "2024-01-01",
        critical: 0,
        major: 0,
        minor: 2,
        total: 2,
      }]);
      mockGetReviewDetail.mockResolvedValue({
        summary: "2 warnings found",
        files: [{ name: "REVIEW-repo.md", content: "Warning: typo found" }],
      });

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const gatePhase = phases[4];
      if (gatePhase.kind !== "function") return;

      const appendedPhases: PipelinePhase[] = [];
      const ctx = createMockCtx({
        runChild: vi.fn(async (label, _prompt, opts) => {
          if (opts?.onResultText && label === "Autonomous Gate") {
            opts.onResultText(JSON.stringify({
              shouldLoop: true,
              reason: "Typo should be fixed",
              fixableIssues: ["Fix executer -> executor typo"],
            }));
          }
          return true;
        }),
        appendPhases: vi.fn((p: PipelinePhase[]) => { appendedPhases.push(...p); }),
      });

      await gatePhase.fn(ctx);

      expect(ctx.emitResult).toHaveBeenCalledWith(
        expect.stringContaining("Continue"),
      );
      // Should append: Update TODO + next cycle (Execute, Review, Gate)
      expect(appendedPhases).toHaveLength(4);
      expect(appendedPhases.map((p) => p.kind === "function" && p.label)).toEqual([
        "Cycle 1: Update TODO",
        "Cycle 2: Execute",
        "Cycle 2: Review",
        "Cycle 2: Gate",
      ]);
    });

    it("update-todo phase strips completed TODOs and runs update pipeline", async () => {
      mockGetReviewSessions.mockResolvedValue([{
        timestamp: "2024-01-01",
        critical: 1,
        major: 0,
        minor: 0,
        total: 1,
      }]);
      mockGetReviewDetail.mockResolvedValue({
        summary: "critical issue",
        files: [{ name: "REVIEW-repo.md", content: "Critical bug" }],
      });

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
        repo: "my-repo",
      });
      const gatePhase = phases[4];
      if (gatePhase.kind !== "function") return;

      // Run gate to get the appended Update TODO phase
      const appendedPhases: PipelinePhase[] = [];
      const gateCtx = createMockCtx({
        runChild: vi.fn(async (_label, _prompt, opts) => {
          if (opts?.onResultText && _label === "Autonomous Gate") {
            opts.onResultText(JSON.stringify({
              shouldLoop: true,
              reason: "Fix critical bug",
              fixableIssues: ["Fix the bug"],
            }));
          }
          return true;
        }),
        appendPhases: vi.fn((p: PipelinePhase[]) => { appendedPhases.push(...p); }),
      });
      await gatePhase.fn(gateCtx);

      // Now run the appended Update TODO phase
      const updatePhase = appendedPhases[0];
      if (updatePhase.kind !== "function") return;
      const updateCtx = createMockCtx();
      await updatePhase.fn(updateCtx);

      expect(mockStripCompletedTodos).toHaveBeenCalledWith("test-ws", "my-repo");
      expect(mockBuildUpdateTodo).toHaveBeenCalled();
    });

    it("gate phase does not append create-pr when giveUp is true", async () => {
      mockGetReviewSessions.mockResolvedValue([{
        timestamp: "2024-01-01",
        critical: 0,
        major: 0,
        minor: 1,
        total: 1,
      }]);
      mockGetReviewDetail.mockResolvedValue({
        summary: "1 suggestion found",
        files: [{ name: "REVIEW-repo.md", content: "Suggestion: add comments" }],
      });

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const gatePhase = phases[4];
      if (gatePhase.kind !== "function") return;

      const appendedPhases: PipelinePhase[] = [];
      const ctx = createMockCtx({
        runChild: vi.fn(async (label, _prompt, opts) => {
          if (opts?.onResultText && label === "Autonomous Gate") {
            opts.onResultText(JSON.stringify({
              shouldLoop: false,
              giveUp: true,
              reason: "Unable to resolve the issue — it requires external API access",
              fixableIssues: [],
            }));
          }
          return true;
        }),
        appendPhases: vi.fn((p: PipelinePhase[]) => { appendedPhases.push(...p); }),
      });

      await gatePhase.fn(ctx);

      // giveUp: true → no Create PR appended
      expect(appendedPhases).toHaveLength(0);
      expect(ctx.emitResult).toHaveBeenCalledWith(
        expect.stringContaining("Give up"),
      );
    });

    it("does not strip TODOs when gate says stop", async () => {
      mockGetReviewSessions.mockResolvedValue([]);

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const gatePhase = phases[4];
      if (gatePhase.kind !== "function") return;

      const appendedPhases: PipelinePhase[] = [];
      const ctx = createMockCtx({
        appendPhases: vi.fn((p: PipelinePhase[]) => { appendedPhases.push(...p); }),
      });
      await gatePhase.fn(ctx);

      // Gate returned shouldLoop: false → no Update TODO appended
      expect(mockStripCompletedTodos).not.toHaveBeenCalled();
      expect(appendedPhases).toHaveLength(1);
      if (appendedPhases[0].kind === "function") {
        expect(appendedPhases[0].label).toBe("Create PR");
      }
    });
  });

  describe("ensure repositories phase", () => {
    it("skips when every README repository is already set up", async () => {
      mockListWorkspaceRepos.mockReturnValue([
        { repoPath: "github.com/sters/repo", repoName: "repo", worktreePath: "/x" },
      ]);
      mockReadWorkspaceReadme.mockResolvedValue({
        content: "",
        meta: {
          title: "t",
          taskType: "feature",
          ticketId: "",
          date: "",
          repositories: [
            { alias: "repo", path: "github.com/sters/repo", baseBranch: "main" },
          ],
        },
      });

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const ensurePhase = phases[0];
      if (ensurePhase.kind !== "function") return;
      expect(ensurePhase.label).toBe("Ensure repositories");

      const ctx = createMockCtx();
      const result = await ensurePhase.fn(ctx);

      expect(result).toBe(true);
      expect(mockSetupRepository).not.toHaveBeenCalled();
    });

    it("sets up only the README repositories missing from the workspace", async () => {
      // Initial state: one of two README repos already set up. After setupRepository: both.
      mockListWorkspaceRepos
        .mockReturnValueOnce([
          { repoPath: "github.com/sters/already", repoName: "already", worktreePath: "/a" },
        ])
        .mockReturnValueOnce([
          { repoPath: "github.com/sters/already", repoName: "already", worktreePath: "/a" },
          { repoPath: "github.com/sters/new", repoName: "new", worktreePath: "/b" },
        ]);
      mockReadWorkspaceReadme.mockResolvedValue({
        content: "",
        meta: {
          title: "t",
          taskType: "feature",
          ticketId: "",
          date: "",
          repositories: [
            { alias: "already", path: "github.com/sters/already", baseBranch: "main" },
            { alias: "new", path: "github.com/sters/new", baseBranch: "main" },
          ],
        },
      });

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const ensurePhase = phases[0];
      if (ensurePhase.kind !== "function") return;

      const ctx = createMockCtx();
      const result = await ensurePhase.fn(ctx);

      expect(result).toBe(true);
      expect(mockSetupRepository).toHaveBeenCalledTimes(1);
      expect(mockSetupRepository).toHaveBeenCalledWith(
        "test-ws",
        "github.com/sters/new",
        "main",
        expect.any(Function),
      );
    });

    it("returns false when README has no repos and no worktrees exist", async () => {
      mockListWorkspaceRepos.mockReturnValue([]);
      mockReadWorkspaceReadme.mockResolvedValue({
        content: "",
        meta: { title: "t", taskType: "feature", ticketId: "", date: "", repositories: [] },
      });

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const ensurePhase = phases[0];
      if (ensurePhase.kind !== "function") return;

      const ctx = createMockCtx();
      const result = await ensurePhase.fn(ctx);

      expect(result).toBe(false);
      expect(mockSetupRepository).not.toHaveBeenCalled();
    });

    it("proceeds when README has no entries but worktrees exist on disk", async () => {
      mockListWorkspaceRepos.mockReturnValue([
        { repoPath: "github.com/sters/repo", repoName: "repo", worktreePath: "/x" },
      ]);
      mockReadWorkspaceReadme.mockResolvedValue({
        content: "",
        meta: { title: "t", taskType: "feature", ticketId: "", date: "", repositories: [] },
      });

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const ensurePhase = phases[0];
      if (ensurePhase.kind !== "function") return;

      const ctx = createMockCtx();
      const result = await ensurePhase.fn(ctx);

      expect(result).toBe(true);
      expect(mockSetupRepository).not.toHaveBeenCalled();
    });

    it("returns false when a README repository remains unset after setup attempt", async () => {
      mockListWorkspaceRepos.mockReturnValue([]);
      mockReadWorkspaceReadme.mockResolvedValue({
        content: "",
        meta: {
          title: "t",
          taskType: "feature",
          ticketId: "",
          date: "",
          repositories: [
            { alias: "repo", path: "github.com/x/y", baseBranch: "main" },
          ],
        },
      });
      mockSetupRepository.mockImplementation(() => {
        throw new Error("clone failed");
      });

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const ensurePhase = phases[0];
      if (ensurePhase.kind !== "function") return;

      const ctx = createMockCtx();
      const result = await ensurePhase.fn(ctx);

      expect(result).toBe(false);
    });
  });

  describe("ensure todos phase", () => {
    it("skips when every workspace repo has a TODO file", async () => {
      mockListWorkspaceRepos.mockReturnValue([
        { repoPath: "github.com/sters/repo", repoName: "repo", worktreePath: "/x" },
      ]);
      mockGetTodos.mockResolvedValue([
        { repoName: "repo", filename: "TODO-repo.md", total: 1, done: 0, blocked: 0, inProgress: 0 },
      ]);
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const ensureTodos = phases[1];
      if (ensureTodos.kind !== "function") return;
      expect(ensureTodos.label).toBe("Ensure TODOs");

      const ctx = createMockCtx();
      const result = await ensureTodos.fn(ctx);

      expect(result).toBe(true);
      expect(mockBuildInitTodoAnalysis).not.toHaveBeenCalled();
    });

    it("runs TODO analysis only for repos missing TODO files", async () => {
      mockListWorkspaceRepos.mockReturnValue([
        { repoPath: "github.com/sters/already", repoName: "already", worktreePath: "/a" },
        { repoPath: "github.com/sters/new", repoName: "new", worktreePath: "/b" },
      ]);
      mockGetTodos.mockResolvedValue([
        { repoName: "already", filename: "TODO-already.md", total: 1, done: 0, blocked: 0, inProgress: 0 },
      ]);
      mockReadWorkspaceReadme.mockResolvedValue({
        content: "",
        meta: { title: "t", taskType: "feature", ticketId: "", date: "", repositories: [] },
      });

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const ensureTodos = phases[1];
      if (ensureTodos.kind !== "function") return;

      const ctx = createMockCtx();
      const result = await ensureTodos.fn(ctx);

      expect(result).toBe(true);
      expect(mockBuildInitTodoAnalysis).toHaveBeenCalledTimes(1);
      const call = mockBuildInitTodoAnalysis.mock.calls[0]?.[0];
      expect(call?.repos()).toEqual([
        { repoPath: "github.com/sters/new", repoName: "new", worktreePath: "/b" },
      ]);
      expect(call?.taskType()).toBe("feature");
    });

    it("returns false when no repos are set up at all", async () => {
      mockListWorkspaceRepos.mockReturnValue([]);
      mockGetTodos.mockResolvedValue([]);

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const ensureTodos = phases[1];
      if (ensureTodos.kind !== "function") return;

      const ctx = createMockCtx();
      const result = await ensureTodos.fn(ctx);

      expect(result).toBe(false);
      expect(mockBuildInitTodoAnalysis).not.toHaveBeenCalled();
    });
  });

  describe("resume support", () => {
    it("pre-generates cycle phases for resume", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
        resumeCycles: [
          { cycle: 1, hasUpdateTodo: true },
          { cycle: 2, hasUpdateTodo: true },
          { cycle: 3, hasUpdateTodo: false },
        ],
      });
      // Cycle 1: Execute, Review, Gate, Update TODO (4)
      // Cycle 2: Execute, Review, Gate, Update TODO (4)
      // Cycle 3: Execute, Review, Gate (3)
      expect(phases).toHaveLength(11);
      expect(phases.map((p) => p.kind === "function" && p.label)).toEqual([
        "Cycle 1: Execute", "Cycle 1: Review", "Cycle 1: Gate", "Cycle 1: Update TODO",
        "Cycle 2: Execute", "Cycle 2: Review", "Cycle 2: Gate", "Cycle 2: Update TODO",
        "Cycle 3: Execute", "Cycle 3: Review", "Cycle 3: Gate",
      ]);
    });

    it("includes Create PR phase for resume when requested", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
        resumeCycles: [
          { cycle: 1, hasUpdateTodo: true },
          { cycle: 2, hasUpdateTodo: false },
        ],
        resumeWithCreatePr: true,
      });
      // Cycle 1: 4 + Cycle 2: 3 + Create PR: 1 = 8
      expect(phases).toHaveLength(8);
      const lastPhase = phases[phases.length - 1];
      if (lastPhase.kind === "function") {
        expect(lastPhase.label).toBe("Create PR");
      }
    });

    it("omits salvage phases on resume by default (saved phases didn't have them)", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
        resumeCycles: [{ cycle: 1, hasUpdateTodo: false }],
      });
      const labels = phases.map((p) => p.kind === "function" && p.label);
      expect(labels).not.toContain("Ensure repositories");
      expect(labels).not.toContain("Ensure TODOs");
    });

    it("includes Ensure repositories on resume when resumeWithEnsureRepos is true", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
        resumeCycles: [{ cycle: 1, hasUpdateTodo: false }],
        resumeWithEnsureRepos: true,
      });
      expect(phases[0].kind === "function" && phases[0].label).toBe(
        "Ensure repositories",
      );
    });

    it("includes Ensure TODOs on resume when resumeWithEnsureTodos is true", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
        resumeCycles: [{ cycle: 1, hasUpdateTodo: false }],
        resumeWithEnsureTodos: true,
      });
      const labels = phases.map((p) => p.kind === "function" && p.label);
      expect(labels).toContain("Ensure TODOs");
    });
  });
});
