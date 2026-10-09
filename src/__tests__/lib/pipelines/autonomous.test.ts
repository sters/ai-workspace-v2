import { vi, describe, it, expect, beforeEach } from "vitest";
import type { PipelinePhase, PhaseFunctionContext } from "@/types/pipeline";

vi.mock("@/lib/pipeline-manager", () => ({
  getOperation: vi.fn(),
}));
vi.mock("@/lib/config", () => ({
  getResolvedWorkspaceRoot: () => "/mock/workspace-root",
  getWorkspaceDir: () => "/mock/workspace-root/workspace",
  getConfig: vi.fn(() => ({
    operations: { defaultInteractionLevel: "mid", typeOverrides: {} },
  })),
  getOperationConfig: vi.fn(() => ({
    claudeTimeoutMinutes: 20,
    functionTimeoutMinutes: 3,
    defaultInteractionLevel: "mid",
    batchSize: 15,
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
  parseConstraints: vi.fn(() => []),
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
vi.mock("@/lib/workspace/known-findings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace/known-findings")>();
  return {
    ...actual,
    readKnownFindings: vi.fn(async () => ""),
    appendKnownFindings: vi.fn(async (_p: string, f: unknown[]) => f),
  };
});

import { buildAutonomousPipeline, resolveUnfinishedRepositories } from "@/lib/pipelines/autonomous";
import { FINAL_CYCLE_STOP_PREFIX } from "@/lib/templates/prompts/autonomous-gate";
import { executePhaseBudgetMs, ROUTINE_BATCH_COUNT } from "@/lib/pipeline/constants";
import { getOperationConfig } from "@/lib/config";
import { appendKnownFindings } from "@/lib/workspace/known-findings";
import { parseAcceptanceCriteria } from "@/lib/parsers/readme";
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
const mockAppendKnownFindings = vi.mocked(appendKnownFindings);
const mockParseAcceptanceCriteria = vi.mocked(parseAcceptanceCriteria);

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
    it("includes update-todo phase when startWith is update-todo", () => {
      const phases = buildAutonomousPipeline({
        startWith: "update-todo",
        workspace: "test-ws",
        instruction: "fix things",
      });
      // Ensure repositories + Ensure TODOs + update-todo + Cycle 1
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

      expect(mockStripCompletedTodos).toHaveBeenCalledWith("test-ws", { repository: undefined });
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

    // The judge runs where the criteria are written — the init path's clarity
    // gate, or an update-readme operation — not on every run that reads them.
    it.each(["execute", "update-todo"] as const)(
      "does not re-judge criteria feasibility when startWith is %s",
      (startWith) => {
        const phases = buildAutonomousPipeline({ startWith, workspace: "test-ws" });
        const labels = phases.map((p) => p.kind === "function" && p.label);
        expect(labels).not.toContain("Check criteria feasibility");
      },
    );

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
      // On the init path the feasibility judge runs inside the clarity phase's
      // group rather than as a phase behind it — the two judges are independent.
      expect(labels).not.toContain("Check criteria feasibility");
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

    /** Mock runChildGroup that feeds each child the verdict registered for its label. */
    function groupCtxReturning(verdicts: Record<string, unknown>, appended: PipelinePhase[]) {
      const seen: string[][] = [];
      const ctx = createMockCtx({
        appendPhases: vi.fn((p: PipelinePhase[]) => { appended.push(...p); }),
        runChildGroup: vi.fn(async (children) => {
          seen.push(children.map((c) => c.label));
          for (const child of children) {
            if (child.onResultText && child.label in verdicts) {
              child.onResultText(JSON.stringify(verdicts[child.label]));
            }
          }
          return children.map(() => true);
        }),
      });
      return { ctx, seen };
    }

    beforeEach(() => {
      mockParseAcceptanceCriteria.mockReturnValue([
        { text: "Rows render on the detail screen", kind: "auto", checked: false },
      ]);
    });

    it("runs the clarity and feasibility judges as one parallel group", async () => {
      const phase = getClarityGatePhase();
      const appended: PipelinePhase[] = [];
      const { ctx, seen } = groupCtxReturning(
        { "README Clarity Gate": { sufficient: true, reason: "clear", missing: [] } },
        appended,
      );

      expect(await phase.fn(ctx)).toBe(true);
      expect(ctx.runChildGroup).toHaveBeenCalledTimes(1);
      expect(seen[0]).toEqual(["README Clarity Gate", "Criteria Feasibility"]);
      expect(ctx.runChild).not.toHaveBeenCalled();
    });

    it("appends Cycle 1 without a separate feasibility phase when the README is sufficient", async () => {
      const phase = getClarityGatePhase();
      const appended: PipelinePhase[] = [];
      const { ctx } = groupCtxReturning(
        { "README Clarity Gate": { sufficient: true, reason: "clear", missing: [] } },
        appended,
      );

      expect(await phase.fn(ctx)).toBe(true);
      expect(appended.map((p) => p.kind === "function" && p.label)).toEqual([
        "Cycle 1: Execute",
        "Cycle 1: Review",
        "Cycle 1: Gate",
      ]);
    });

    it("records infeasible criteria from the group when the README is clear", async () => {
      const phase = getClarityGatePhase();
      const appended: PipelinePhase[] = [];
      const { ctx } = groupCtxReturning(
        {
          "README Clarity Gate": { sufficient: true, reason: "clear", missing: [] },
          "Criteria Feasibility": {
            infeasible: [{ criterion: "Rows render on the detail screen", reason: "schema owned elsewhere" }],
          },
        },
        appended,
      );

      expect(await phase.fn(ctx)).toBe(true);
      expect(mockAppendKnownFindings).toHaveBeenCalledTimes(1);
      const [, findings] = mockAppendKnownFindings.mock.calls[0];
      expect(findings[0].kind).toBe("infeasible");
    });

    it("omits the feasibility child when the README has no (auto) criteria", async () => {
      mockParseAcceptanceCriteria.mockReturnValue([
        { text: "Figma comparison", kind: "manual", checked: false },
      ]);
      const phase = getClarityGatePhase();
      const appended: PipelinePhase[] = [];
      const { ctx, seen } = groupCtxReturning(
        { "README Clarity Gate": { sufficient: true, reason: "clear", missing: [] } },
        appended,
      );

      expect(await phase.fn(ctx)).toBe(true);
      expect(seen[0]).toEqual(["README Clarity Gate"]);
      expect(mockAppendKnownFindings).not.toHaveBeenCalled();
    });

    it("stops and recommends refining the README when judged insufficient", async () => {
      const phase = getClarityGatePhase();
      const appended: PipelinePhase[] = [];
      const { ctx } = groupCtxReturning(
        {
          "README Clarity Gate": {
            sufficient: false,
            reason: "Goal is a placeholder",
            missing: ["Concrete goal", "At least one auto acceptance criterion"],
          },
          "Criteria Feasibility": {
            infeasible: [{ criterion: "Rows render on the detail screen", reason: "schema owned elsewhere" }],
          },
        },
        appended,
      );
      const result = await phase.fn(ctx);

      // Graceful stop: no cycle phases appended, run ends without touching code.
      expect(result).toBe(true);
      expect(appended).toHaveLength(0);
      expect(ctx.emitResult).toHaveBeenCalledWith(expect.stringContaining("too unclear"));
      expect(ctx.emitResult).toHaveBeenCalledWith(expect.stringContaining("update-readme"));
      // The criteria are about to be rewritten, so a verdict against the old ones
      // must not be frozen into the ledger.
      expect(mockAppendKnownFindings).not.toHaveBeenCalled();
    });

    it("fails open (proceeds) when the clarity judge returns no verdict", async () => {
      const phase = getClarityGatePhase();
      const appended: PipelinePhase[] = [];
      const { ctx } = groupCtxReturning({}, appended);
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
    // Index-based lookups break whenever a leading phase is added, so address
    // cycle phases by label.
    function phaseByLabel(phases: PipelinePhase[], label: string) {
      const phase = phases.find((p) => p.kind === "function" && p.label === label);
      if (!phase || phase.kind !== "function") throw new Error(`phase not found: ${label}`);
      return phase;
    }

    // `runSubPhases` ignores the sub-pipeline's own timeoutMs, so this wrapper is
    // the only budget that applies. A wrapper tighter than what execute.ts sizes
    // itself for fires first and makes that sizing dead code — which is what a
    // hardcoded figure here did once PER_ITEM_BUDGET_MS moved.
    it("execute phase budget covers what execute.ts sizes itself for", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const execPhase = phaseByLabel(phases, "Cycle 1: Execute");

      const { batchSize } = vi.mocked(getOperationConfig)("execute");
      expect(execPhase.timeoutMs).toBeGreaterThanOrEqual(
        executePhaseBudgetMs(ROUTINE_BATCH_COUNT, batchSize),
      );
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
      const execPhase = phaseByLabel(phases, "Cycle 1: Execute");

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
      const gatePhase = phaseByLabel(phases, "Cycle 1: Gate");

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

    it("asks for no fix verification on the first cycle, which has no prior asks", async () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      await phaseByLabel(phases, "Cycle 1: Review").fn(createMockCtx());

      expect(mockBuildReview).toHaveBeenCalledWith(
        expect.objectContaining({ requestedFixes: undefined }),
      );
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
      const gatePhase = phaseByLabel(phases, "Cycle 1: Gate");

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

      expect(mockStripCompletedTodos).toHaveBeenCalledWith("test-ws", {
        repository: "my-repo",
        repositories: undefined,
      });
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
      const gatePhase = phaseByLabel(phases, "Cycle 1: Gate");

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

    describe("final cycle", () => {
      function gateCtxReturning(payload: Record<string, unknown>) {
        const appendedPhases: PipelinePhase[] = [];
        const ctx = createMockCtx({
          runChild: vi.fn(async (label, _prompt, opts) => {
            if (opts?.onResultText && label === "Autonomous Gate") {
              opts.onResultText(JSON.stringify(payload));
            }
            return true;
          }),
          appendPhases: vi.fn((p: PipelinePhase[]) => { appendedPhases.push(...p); }),
        });
        return { ctx, appendedPhases };
      }

      beforeEach(() => {
        mockGetReviewSessions.mockResolvedValue([{
          timestamp: "2024-01-01", critical: 1, major: 0, minor: 0, total: 1,
        }]);
        mockGetReviewDetail.mockResolvedValue({
          summary: "1 critical issue",
          files: [{ name: "REVIEW-repo.md", content: "Critical: unhandled error" }],
        });
      });

      // The gate used to short-circuit at maxLoops without calling the model, so
      // the last cycle's whole review — the most expensive phase of a cycle — was
      // produced and then read by nobody.
      it("still evaluates the review on the last cycle instead of short-circuiting", async () => {
        const phases = buildAutonomousPipeline({
          startWith: "execute", workspace: "test-ws", maxLoops: 1,
        });
        const { ctx } = gateCtxReturning({
          shouldLoop: false, giveUp: false, reason: "done", fixableIssues: [],
        });

        await phaseByLabel(phases, "Cycle 1: Gate").fn(ctx);

        expect(ctx.runChild).toHaveBeenCalledWith(
          "Autonomous Gate", expect.any(String), expect.anything(),
        );
      });

      // create-pr is the end of the work, not a handoff: a PR that ships with the
      // run's own leftovers in it is what the human then has to finish by hand.
      it("stops without creating a PR when the last cycle still has work left", async () => {
        const phases = buildAutonomousPipeline({
          startWith: "execute", workspace: "test-ws", maxLoops: 2,
        });
        const { ctx, appendedPhases } = gateCtxReturning({
          shouldLoop: true,
          giveUp: false,
          reason: "Unhandled error path is still open",
          fixableIssues: ["handle the nil branch in parse()"],
        });

        // Cycle 2 is the last one when maxLoops is 2.
        const result = await phaseByLabel(phases, "Cycle 1: Gate").fn(ctx);
        const cycle2Gate = appendedPhases.find(
          (p) => p.kind === "function" && p.label === "Cycle 2: Gate",
        );
        if (!cycle2Gate || cycle2Gate.kind !== "function") throw new Error("no cycle 2 gate");
        expect(result).toBe(true);

        const final = gateCtxReturning({
          shouldLoop: true,
          giveUp: false,
          reason: "Unhandled error path is still open",
          fixableIssues: ["handle the nil branch in parse()"],
        });
        await cycle2Gate.fn(final.ctx);

        expect(final.appendedPhases).toHaveLength(0);
        expect(final.ctx.emitResult).toHaveBeenCalledWith(
          expect.stringContaining(FINAL_CYCLE_STOP_PREFIX),
        );
        expect(final.ctx.emitResult).toHaveBeenCalledWith(
          expect.stringContaining("handle the nil branch in parse()"),
        );
      });

      it("creates the PR when the last cycle reports the work complete", async () => {
        const phases = buildAutonomousPipeline({
          startWith: "execute", workspace: "test-ws", maxLoops: 1,
        });
        const { ctx, appendedPhases } = gateCtxReturning({
          shouldLoop: false,
          giveUp: false,
          reason: "All criteria satisfied",
          fixableIssues: [],
        });

        await phaseByLabel(phases, "Cycle 1: Gate").fn(ctx);

        expect(appendedPhases.map((p) => p.kind === "function" && p.label)).toEqual(["Create PR"]);
      });
    });

    it("does not strip TODOs when gate says stop", async () => {
      mockGetReviewSessions.mockResolvedValue([]);

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const gatePhase = phaseByLabel(phases, "Cycle 1: Gate");

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

    // Constraint discovery otherwise only runs on the init path, so a repo
    // salvaged into an existing workspace reached review with its commands
    // NOT DECLARED — which reads exactly like a clean run.
    it("discovers constraints for the repository it just set up", async () => {
      mockListWorkspaceRepos
        .mockReturnValueOnce([])
        .mockReturnValueOnce([
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
      expect(await ensurePhase.fn(ctx)).toBe(true);

      const groupCalls = vi.mocked(ctx.runChildGroup).mock.calls;
      expect(groupCalls).toHaveLength(1);
      expect(groupCalls[0][0].map((c) => c.label)).toEqual(["constraints-new"]);
    });

    it("does not fail the run when constraint discovery does not complete", async () => {
      mockListWorkspaceRepos
        .mockReturnValueOnce([])
        .mockReturnValueOnce([
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

      // The worktree is there; only the discovery child failed. Failing here
      // would abort the run over a report the executor can do without.
      const ctx = createMockCtx({ runChildGroup: vi.fn(async () => [false]) });
      expect(await ensurePhase.fn(ctx)).toBe(true);
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

  describe("gate dismissals", () => {
    function gateCtxReturning(verdict: unknown) {
      return createMockCtx({
        runChild: vi.fn(async (label, _prompt, opts) => {
          if (opts?.onResultText && label === "Autonomous Gate") {
            opts.onResultText(JSON.stringify(verdict));
          }
          return true;
        }),
      });
    }

    function getGatePhase() {
      const phases = buildAutonomousPipeline({ startWith: "execute", workspace: "test-ws" });
      const phase = phases.find((p) => p.kind === "function" && p.label === "Cycle 1: Gate");
      if (!phase || phase.kind !== "function") throw new Error("gate phase not found");
      return phase;
    }

    beforeEach(() => {
      mockGetReviewSessions.mockResolvedValue([
        { timestamp: "20260728-102052", repoCount: 1, hasSummary: true },
      ] as never);
      mockGetReviewDetail.mockResolvedValue({
        timestamp: "20260728-102052",
        summary: "# Summary",
        files: [],
      } as never);
    });

    it("appends the gate's dismissed findings to the ledger, tagged with the cycle", async () => {
      const phase = getGatePhase();
      const ctx = gateCtxReturning({
        shouldLoop: false,
        giveUp: false,
        reason: "nothing actionable left",
        fixableIssues: [],
        dismissedFindings: [
          { summary: "golangci-lint v1/v2 mismatch", reason: "environment", kind: "pre-existing" },
          { summary: "Rename helper for clarity", reason: "deferred to PR", kind: "deferred" },
        ],
      });

      expect(await phase.fn(ctx)).toBe(true);
      expect(mockAppendKnownFindings).toHaveBeenCalledTimes(1);
      const [, findings] = mockAppendKnownFindings.mock.calls[0];
      expect(findings).toHaveLength(2);
      expect(findings.every((f: { cycle?: number }) => f.cycle === 1)).toBe(true);
    });

    it("coerces an unknown dismissal kind to the weakest claim", async () => {
      const phase = getGatePhase();
      const ctx = gateCtxReturning({
        shouldLoop: false,
        giveUp: false,
        reason: "done",
        fixableIssues: [],
        dismissedFindings: [{ summary: "Something", reason: "why", kind: "not-a-kind" }],
      });

      await phase.fn(ctx);
      const [, findings] = mockAppendKnownFindings.mock.calls[0];
      expect(findings[0].kind).toBe("deferred");
    });

    it("drops dismissals with no summary rather than writing an empty entry", async () => {
      const phase = getGatePhase();
      const ctx = gateCtxReturning({
        shouldLoop: false,
        giveUp: false,
        reason: "done",
        fixableIssues: [],
        dismissedFindings: [{ summary: "  ", reason: "why", kind: "deferred" }],
      });

      await phase.fn(ctx);
      expect(mockAppendKnownFindings).not.toHaveBeenCalled();
    });

    it("does not touch the ledger when the gate dismissed nothing", async () => {
      const phase = getGatePhase();
      const ctx = gateCtxReturning({
        shouldLoop: true,
        giveUp: false,
        reason: "fix the bug",
        fixableIssues: ["Fix the bug"],
        dismissedFindings: [],
      });

      await phase.fn(ctx);
      expect(mockAppendKnownFindings).not.toHaveBeenCalled();
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

describe("buildAutonomousPipeline — every loop goes through the plan", () => {
  function findPhase(phases: PipelinePhase[], label: string) {
    const p = phases.find((x) => x.kind === "function" && x.label === label);
    if (!p || p.kind !== "function") throw new Error(`no phase ${label}`);
    return p;
  }

  async function runGate(verdict: Record<string, unknown>) {
    mockGetReviewSessions.mockResolvedValue([{
      timestamp: "2024-01-01", critical: 0, major: 0, minor: 1, total: 1,
    }]);
    mockGetReviewDetail.mockResolvedValue({
      summary: "one warning",
      files: [{ name: "REVIEW-repo.md", content: "Warning: duplicate key" }],
    });

    const phases = buildAutonomousPipeline({ startWith: "execute", workspace: "test-ws" });
    const appended: PipelinePhase[] = [];
    const ctx = createMockCtx({
      runChild: vi.fn(async (label, _prompt, opts) => {
        if (opts?.onResultText && label === "Autonomous Gate") {
          opts.onResultText(JSON.stringify(verdict));
        }
        return true;
      }),
      appendPhases: vi.fn((p: PipelinePhase[]) => { appended.push(...p); }),
    });
    await findPhase(phases, "Cycle 1: Gate").fn(ctx);
    return { appended, ctx };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOperation.mockReturnValue({
      id: "test-op",
      workspace: "test-ws",
    } as ReturnType<typeof mockGetOperation>);
  });

  const UNIFORM_ROUND = [
    "Cycle 1: Update TODO",
    "Cycle 2: Execute",
    "Cycle 2: Review",
    "Cycle 2: Gate",
  ];

  it("plans the gate's asks into the TODO file before executing", async () => {
    const { appended } = await runGate({
      shouldLoop: true,
      giveUp: false,
      reason: "two localized fixes left",
      fixableIssues: ["ask one", "ask two"],
    });
    await findPhase(appended, "Cycle 1: Update TODO").fn(createMockCtx());

    expect(mockStripCompletedTodos).toHaveBeenCalled();
    expect(mockBuildUpdateTodo).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.stringContaining("- ask one\n- ask two"),
      }),
    );
  });

  // The fix diff gets the same defect hunt as an execute diff — a full-scope
  // review, narrowed to the diff by the incremental baseline rather than by a
  // reduced child set. The asks still ride along so verify-fixes can check each
  // one landed.
  it("reviews the fix diff at full scope with the asks attached", async () => {
    const { appended } = await runGate({
      shouldLoop: true,
      giveUp: false,
      reason: "one localized fix left",
      fixableIssues: ["include the index in the list key"],
    });

    await findPhase(appended, "Cycle 2: Review").fn(createMockCtx());
    const call = mockBuildReview.mock.calls.at(-1)?.[0];
    expect(call).toMatchObject({ requestedFixes: ["include the index in the list key"] });
    expect(call).not.toHaveProperty("scope");
  });

  it("still runs the round when the gate names no specific asks", async () => {
    const { appended } = await runGate({
      shouldLoop: true,
      giveUp: false,
      reason: "work remains but unspecified",
      fixableIssues: [],
    });
    expect(appended.map((p) => p.kind === "function" && p.label)).toEqual(UNIFORM_ROUND);
  });
});

describe("resolveUnfinishedRepositories", () => {
  const repoNames = ["api", "web", "worker"];
  const noTodos: { repoName: string; pending: number; inProgress: number }[] = [];
  const loop = (unfinishedRepositories: string[] | null) => ({
    shouldLoop: true,
    giveUp: false,
    unfinishedRepositories,
  });

  it("leaves nothing open when the run is done, whatever the list says", () => {
    expect(resolveUnfinishedRepositories({
      gate: { shouldLoop: false, giveUp: false, unfinishedRepositories: ["web"] },
      repoNames, open: repoNames, todos: noTodos,
    })).toEqual([]);
  });

  it("keeps the named repositories, in workspace order", () => {
    expect(resolveUnfinishedRepositories({
      gate: loop(["worker", "api"]), repoNames, open: repoNames, todos: noTodos,
    })).toEqual(["api", "worker"]);
  });

  // Closing a repository wrongly ships its PR unfinished; keeping one open
  // wrongly costs a cycle of review. A list the gate did not give, or gave with
  // names it made up, therefore closes nothing.
  it.each([
    ["no list", null],
    ["an empty list", []],
    ["only unknown names", ["frontend"]],
  ])("keeps everything still open when the gate gives %s", (_case, named) => {
    expect(resolveUnfinishedRepositories({
      gate: loop(named), repoNames, open: ["web", "worker"], todos: noTodos,
    })).toEqual(["web", "worker"]);
  });

  it("does the same for a give-up verdict", () => {
    expect(resolveUnfinishedRepositories({
      gate: { shouldLoop: false, giveUp: true, unfinishedRepositories: null },
      repoNames, open: repoNames, todos: noTodos,
    })).toEqual(repoNames);
  });

  it("keeps a repository with actionable TODO items open even when the gate closed it", () => {
    expect(resolveUnfinishedRepositories({
      gate: loop(["web"]),
      repoNames,
      open: repoNames,
      todos: [
        { repoName: "api", pending: 0, inProgress: 1 },
        { repoName: "worker", pending: 0, inProgress: 0 },
      ],
    })).toEqual(["api", "web"]);
  });
});

describe("buildAutonomousPipeline — repositories finish independently", () => {
  const api = { repoPath: "github.com/sters/api", repoName: "api", worktreePath: "/w/api" };
  const web = { repoPath: "github.com/sters/web", repoName: "web", worktreePath: "/w/web" };

  function findPhase(phases: PipelinePhase[], label: string) {
    const p = phases.find((x) => x.kind === "function" && x.label === label);
    if (!p || p.kind !== "function") throw new Error(`no phase ${label}`);
    return p;
  }

  function gateCtx(verdict: Record<string, unknown>) {
    const appended: PipelinePhase[] = [];
    const prompts: string[] = [];
    const ctx = createMockCtx({
      runChild: vi.fn(async (label, prompt, opts) => {
        if (opts?.onResultText && label === "Autonomous Gate") {
          prompts.push(prompt);
          opts.onResultText(JSON.stringify({ giveUp: false, reason: "r", dismissedFindings: [], ...verdict }));
        }
        return true;
      }),
      appendPhases: vi.fn((p: PipelinePhase[]) => { appended.push(...p); }),
    });
    return { ctx, appended, prompts };
  }

  function session(timestamp: string) {
    return { timestamp, critical: 0, major: 1, minor: 0, total: 1 };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOperation.mockReturnValue({
      id: "test-op",
      workspace: "test-ws",
    } as ReturnType<typeof mockGetOperation>);
    mockListWorkspaceRepos.mockReturnValue([api, web]);
    mockGetTodos.mockResolvedValue([]);
    mockGetReviewSessions.mockResolvedValue([session("s1")]);
    mockGetReviewDetail.mockImplementation(async (_ws, ts) => ({
      summary: `summary ${ts}`,
      files: [
        { name: "REVIEW-github.com_sters_api.md", content: `api review from ${ts}` },
        { name: "REVIEW-github.com_sters_web.md", content: `web review from ${ts}` },
        { name: "REVIEW-cross-repository.md", content: `boundary review from ${ts}` },
      ],
    }));
  });

  /** Cycle 1's gate finds api finished and web not; returns what it appended. */
  async function finishApiInCycle1(maxLoops = 3) {
    const phases = buildAutonomousPipeline({ startWith: "execute", workspace: "test-ws", maxLoops });
    const gate = gateCtx({
      shouldLoop: true,
      fixableIssues: ["handle the empty list in web/src/list.tsx"],
      unfinishedRepositories: ["web"],
    });
    await findPhase(phases, "Cycle 1: Gate").fn(gate.ctx);
    return gate;
  }

  it("plans, executes and reviews only the unfinished repository next cycle", async () => {
    const { appended } = await finishApiInCycle1();

    for (const label of ["Cycle 1: Update TODO", "Cycle 2: Execute", "Cycle 2: Review"]) {
      await findPhase(appended, label).fn(createMockCtx());
    }

    expect(mockStripCompletedTodos).toHaveBeenCalledWith("test-ws", { repository: undefined, repositories: ["web"] });
    expect(mockBuildUpdateTodo).toHaveBeenCalledWith(expect.objectContaining({ repositories: ["web"] }));
    expect(mockBuildExecute).toHaveBeenCalledWith(expect.objectContaining({ repositories: ["web"] }));
    expect(mockBuildReview).toHaveBeenCalledWith(expect.objectContaining({ repositories: ["web"] }));
  });

  it("works on every repository when the gate's list names none of them", async () => {
    const phases = buildAutonomousPipeline({ startWith: "execute", workspace: "test-ws" });
    const gate = gateCtx({ shouldLoop: true, fixableIssues: ["x"], unfinishedRepositories: ["frontend"] });
    await findPhase(phases, "Cycle 1: Gate").fn(gate.ctx);

    await findPhase(gate.appended, "Cycle 2: Execute").fn(createMockCtx());

    expect(mockBuildExecute).toHaveBeenCalledWith(expect.objectContaining({ repositories: undefined }));
  });

  // The latest review no longer covers the finished repository, so without
  // these the gate would judge the contract with that side's evidence missing.
  it("hands the next gate the finished repository's reports from the cycle it finished in", async () => {
    const { appended } = await finishApiInCycle1();
    mockGetReviewSessions.mockResolvedValue([session("s2"), session("s1")]);

    const next = gateCtx({ shouldLoop: false, fixableIssues: [], unfinishedRepositories: [] });
    await findPhase(appended, "Cycle 2: Gate").fn(next.ctx);

    const prompt = next.prompts[0];
    expect(prompt).toMatch(/`api` — finished in cycle 1/);
    expect(prompt).toContain("api review from s1");
    // Only api's own reports carry over; the rest of s1 was superseded by s2.
    expect(prompt).not.toContain("web review from s1");
    expect(prompt).not.toContain("boundary review from s1");
  });

  it("creates every repository's PR when the run finishes", async () => {
    const { appended } = await finishApiInCycle1();
    const next = gateCtx({ shouldLoop: false, fixableIssues: [], unfinishedRepositories: [] });
    await findPhase(appended, "Cycle 2: Gate").fn(next.ctx);

    await findPhase(next.appended, "Create PR").fn(createMockCtx());

    expect(mockBuildCreatePr).toHaveBeenCalledWith(expect.objectContaining({ repositories: undefined }));
  });

  it("still creates the finished repository's PR when the last cycle stops", async () => {
    const phases = buildAutonomousPipeline({ startWith: "execute", workspace: "test-ws", maxLoops: 1 });
    const gate = gateCtx({
      shouldLoop: true,
      fixableIssues: ["handle the empty list in web/src/list.tsx"],
      unfinishedRepositories: ["web"],
    });
    await findPhase(phases, "Cycle 1: Gate").fn(gate.ctx);

    const stop = vi.mocked(gate.ctx.emitResult).mock.calls
      .map((c) => c[0])
      .find((m) => m.startsWith(FINAL_CYCLE_STOP_PREFIX));
    expect(stop).toMatch(/only for the finished repository \(api\); none for web/);

    await findPhase(gate.appended, "Create PR").fn(createMockCtx());
    expect(mockBuildCreatePr).toHaveBeenCalledWith(expect.objectContaining({ repositories: ["api"] }));
  });

  it("creates no PR when the last cycle stops with every repository unfinished", async () => {
    const phases = buildAutonomousPipeline({ startWith: "execute", workspace: "test-ws", maxLoops: 1 });
    const gate = gateCtx({
      shouldLoop: true,
      fixableIssues: ["align the response type on both sides"],
      unfinishedRepositories: ["api", "web"],
    });
    await findPhase(phases, "Cycle 1: Gate").fn(gate.ctx);

    expect(gate.appended).toEqual([]);
  });

  it("creates the finished repository's PR when the gate gives up on the other", async () => {
    const phases = buildAutonomousPipeline({ startWith: "execute", workspace: "test-ws" });
    const gate = gateCtx({
      shouldLoop: false,
      giveUp: true,
      fixableIssues: [],
      unfinishedRepositories: ["web"],
    });
    await findPhase(phases, "Cycle 1: Gate").fn(gate.ctx);

    await findPhase(gate.appended, "Create PR").fn(createMockCtx());
    expect(mockBuildCreatePr).toHaveBeenCalledWith(expect.objectContaining({ repositories: ["api"] }));
  });

  it("reopens a finished repository when a later gate gives it new work", async () => {
    const { appended } = await finishApiInCycle1();
    mockGetReviewSessions.mockResolvedValue([session("s2"), session("s1")]);
    const next = gateCtx({
      shouldLoop: true,
      fixableIssues: ["the boundary moved: update api's handler to match"],
      unfinishedRepositories: ["api", "web"],
    });
    await findPhase(appended, "Cycle 2: Gate").fn(next.ctx);

    await findPhase(next.appended, "Cycle 3: Execute").fn(createMockCtx());
    expect(mockBuildExecute).toHaveBeenLastCalledWith(expect.objectContaining({ repositories: undefined }));
  });
});
