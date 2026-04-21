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

import { buildAutonomousPipeline } from "@/lib/pipelines/autonomous";
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
      // update-todo function phase + Cycle 1 (Execute, Review, Gate)
      expect(phases).toHaveLength(4);
      expect(phases[0].kind).toBe("function");
      if (phases[0].kind === "function") {
        expect(phases[0].label).toBe("Update TODOs");
      }
    });

    it("strips completed TODOs before the leading Update TODOs phase", async () => {
      const phases = buildAutonomousPipeline({
        startWith: "update-todo",
        workspace: "test-ws",
        instruction: "fix things",
      });
      const updatePhase = phases[0];
      if (updatePhase.kind !== "function") return;

      const ctx = createMockCtx();
      await updatePhase.fn(ctx);

      expect(mockStripCompletedTodos).toHaveBeenCalledWith("test-ws", undefined);
      expect(mockBuildUpdateTodo).toHaveBeenCalled();
    });

    it("has 3 phases (Execute, Review, Gate) when startWith is execute", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      expect(phases).toHaveLength(3);
      expect(phases.map((p) => p.kind === "function" && p.label)).toEqual([
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
      const execPhase = phases[0];
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
      const reviewPhase = phases[1];
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
      const gatePhase = phases[2];
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
      expect(phases[0].kind === "function" && phases[0].timeoutMs).toBe(25 * 60 * 1000);
      expect(phases[1].kind === "function" && phases[1].timeoutMs).toBe(15 * 60 * 1000);
      expect(phases[2].kind === "function" && phases[2].timeoutMs).toBe(10 * 60 * 1000);
    });

    it("returns false when no workspace is found", async () => {
      mockGetOperation.mockReturnValue(undefined);

      const phases = buildAutonomousPipeline({
        startWith: "execute",
      });
      const execPhase = phases[0];
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
      const gatePhase = phases[2];
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
      const gatePhase = phases[2];
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

    it("does not strip TODOs when gate says stop", async () => {
      mockGetReviewSessions.mockResolvedValue([]);

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const gatePhase = phases[2];
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
  });
});
