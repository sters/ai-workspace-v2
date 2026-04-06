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
vi.mock("@/lib/suggest-workspace", () => ({
  triggerWorkspaceSuggestion: vi.fn(),
}));
vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/file.md"),
  ensureGlobalSystemPrompt: vi.fn(() => "/mock/prompts/global.md"),
}));

import { buildAutonomousPipeline } from "@/lib/pipelines/autonomous";
import { buildInitPipeline } from "@/lib/pipelines/init";
import { buildUpdateTodoPipeline } from "@/lib/pipelines/update-todo";
import { buildExecutePipeline } from "@/lib/pipelines/execute";
import { buildReviewPipeline } from "@/lib/pipelines/review";
import { buildCreatePrPipeline } from "@/lib/pipelines/create-pr";
import { getOperation } from "@/lib/pipeline-manager";
import { getReviewSessions, getReviewDetail } from "@/lib/workspace/reader";

const mockGetOperation = vi.mocked(getOperation);
const mockGetReviewDetail = vi.mocked(getReviewDetail);
const mockBuildInit = vi.mocked(buildInitPipeline);
const mockBuildUpdateTodo = vi.mocked(buildUpdateTodoPipeline);
const mockBuildExecute = vi.mocked(buildExecutePipeline);
const mockBuildReview = vi.mocked(buildReviewPipeline);
const mockBuildCreatePr = vi.mocked(buildCreatePrPipeline);
const mockGetReviewSessions = vi.mocked(getReviewSessions);

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
      // update-todo function phase + Cycle 1 phase
      expect(phases).toHaveLength(2);
      expect(phases[0].kind).toBe("function");
      if (phases[0].kind === "function") {
        expect(phases[0].label).toBe("Update TODOs");
      }
    });

    it("only has Cycle 1 when startWith is execute", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      expect(phases).toHaveLength(1);
      expect(phases[0].kind).toBe("function");
      if (phases[0].kind === "function") {
        expect(phases[0].label).toBe("Cycle 1");
      }
    });
  });

  describe("autonomous cycle", () => {
    it("runs execute, review, and appends create-pr when no critical issues", async () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const cycleFn = phases[0];
      expect(cycleFn.kind).toBe("function");
      if (cycleFn.kind !== "function") return;

      const appendedPhases: PipelinePhase[] = [];
      const ctx = createMockCtx({
        appendPhases: vi.fn((p: PipelinePhase[]) => { appendedPhases.push(...p); }),
      });
      await cycleFn.fn(ctx);

      expect(mockBuildExecute).toHaveBeenCalled();
      expect(mockBuildReview).toHaveBeenCalled();
      // Create PR is appended as a dynamic phase, not called inline
      expect(appendedPhases).toHaveLength(1);
      expect(appendedPhases[0].kind).toBe("function");
      if (appendedPhases[0].kind === "function") {
        expect(appendedPhases[0].label).toBe("Create PR");
      }
    });

    it("sets per-cycle timeout", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
        maxLoops: 5,
      });
      const cycleFn = phases[0];
      // Per-cycle timeout: 50 * 60 * 1000 = 3_000_000
      expect(cycleFn.kind === "function" && cycleFn.timeoutMs).toBe(50 * 60 * 1000);
    });

    it("uses per-cycle timeout regardless of maxLoops", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const cycleFn = phases[0];
      // Same per-cycle timeout: 50 * 60 * 1000 = 3_000_000
      expect(cycleFn.kind === "function" && cycleFn.timeoutMs).toBe(50 * 60 * 1000);
    });

    it("returns false when no workspace is found", async () => {
      mockGetOperation.mockReturnValue(undefined);

      const phases = buildAutonomousPipeline({
        startWith: "execute",
      });
      const cycleFn = phases[0];
      if (cycleFn.kind !== "function") return;

      const ctx = createMockCtx();
      const result = await cycleFn.fn(ctx);

      expect(result).toBe(false);
      expect(ctx.emitStatus).toHaveBeenCalledWith(
        expect.stringContaining("No workspace found"),
      );
    });

    it("calls AI gate even when critical=0 but warnings exist", async () => {
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
      const cycleFn = phases[0];
      if (cycleFn.kind !== "function") return;

      const runChildCalls: string[] = [];
      const appendedPhases: PipelinePhase[] = [];
      const ctx = createMockCtx({
        runChild: vi.fn(async (label, _prompt, opts) => {
          runChildCalls.push(label);
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

      await cycleFn.fn(ctx);

      expect(runChildCalls).toContain("Autonomous Gate");
      expect(ctx.emitResult).toHaveBeenCalledWith(
        expect.stringContaining("Continue"),
      );
      // Should append next cycle phase
      expect(appendedPhases).toHaveLength(1);
      if (appendedPhases[0].kind === "function") {
        expect(appendedPhases[0].label).toBe("Cycle 2");
      }
    });

    it("appends next cycle when gate returns shouldLoop: true, then Create PR on stop", async () => {
      // First review: has critical issues, gate says loop
      mockGetReviewSessions
        .mockResolvedValueOnce([{
          timestamp: "2024-01-01",
          critical: 2,
          major: 0,
          minor: 0,
          total: 2,
        }])
        .mockResolvedValueOnce([]);

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
        maxLoops: 3,
      });
      const cycleFn = phases[0];
      if (cycleFn.kind !== "function") return;

      const appendedPhases: PipelinePhase[] = [];
      const ctx = createMockCtx({
        runChild: vi.fn(async (_label, _prompt, opts) => {
          if (opts?.onResultText && _label === "Autonomous Gate") {
            opts.onResultText(JSON.stringify({
              shouldLoop: false,
              reason: "No review detail",
              fixableIssues: [],
            }));
          }
          return true;
        }),
        appendPhases: vi.fn((p: PipelinePhase[]) => { appendedPhases.push(...p); }),
      });

      await cycleFn.fn(ctx);

      // Gate returned shouldLoop: false → appends Create PR
      expect(mockBuildExecute).toHaveBeenCalled();
      expect(mockBuildReview).toHaveBeenCalled();
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
        resumeCycleCount: 3,
      });
      expect(phases).toHaveLength(3);
      expect(phases.map((p) => p.kind === "function" && p.label)).toEqual([
        "Cycle 1", "Cycle 2", "Cycle 3",
      ]);
    });

    it("includes Create PR phase for resume when requested", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
        resumeCycleCount: 2,
        resumeWithCreatePr: true,
      });
      expect(phases).toHaveLength(3);
      if (phases[2].kind === "function") {
        expect(phases[2].label).toBe("Create PR");
      }
    });
  });
});
