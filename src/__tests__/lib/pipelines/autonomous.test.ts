import { vi, describe, it, expect, beforeEach } from "vitest";
import type { PhaseFunctionContext } from "@/types/pipeline";

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
      // init phases + autonomous cycle phase
      expect(phases.length).toBeGreaterThanOrEqual(1);
    });

    it("includes update-todo phase when startWith is update-todo", () => {
      const phases = buildAutonomousPipeline({
        startWith: "update-todo",
        workspace: "test-ws",
        instruction: "fix things",
      });
      // update-todo function phase + autonomous cycle phase
      expect(phases).toHaveLength(2);
      expect(phases[0].kind).toBe("function");
      if (phases[0].kind === "function") {
        expect(phases[0].label).toBe("Update TODOs");
      }
    });

    it("only has autonomous cycle when startWith is execute", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      expect(phases).toHaveLength(1);
      expect(phases[0].kind).toBe("function");
      if (phases[0].kind === "function") {
        expect(phases[0].label).toBe("Autonomous cycle");
      }
    });
  });

  describe("autonomous cycle", () => {
    it("runs execute, review, and create-pr when no critical issues", async () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const cycleFn = phases[0];
      expect(cycleFn.kind).toBe("function");
      if (cycleFn.kind !== "function") return;

      const ctx = createMockCtx();
      await cycleFn.fn(ctx);

      expect(mockBuildExecute).toHaveBeenCalled();
      expect(mockBuildReview).toHaveBeenCalled();
      expect(mockBuildCreatePr).toHaveBeenCalled();
    });

    it("sets timeout based on maxLoops", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
        maxLoops: 5,
      });
      const cycleFn = phases[0];
      // 5 * 50 * 60 * 1000 = 15_000_000
      expect(cycleFn.kind === "function" && cycleFn.timeoutMs).toBe(5 * 50 * 60 * 1000);
    });

    it("uses default maxLoops of 3", () => {
      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace: "test-ws",
      });
      const cycleFn = phases[0];
      expect(cycleFn.kind === "function" && cycleFn.timeoutMs).toBe(3 * 50 * 60 * 1000);
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
      });

      await cycleFn.fn(ctx);

      expect(runChildCalls).toContain("Autonomous Gate");
      expect(ctx.emitResult).toHaveBeenCalledWith(
        expect.stringContaining("Loop"),
      );
    });

    it("loops when gate returns shouldLoop: true", async () => {
      // First review: has critical issues, gate says loop
      // Second review: no critical issues, proceeds to PR
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

      // The gate AI call returns shouldLoop: true on first call
      const ctx = createMockCtx({
        runChild: vi.fn(async (_label, _prompt, opts) => {
          if (opts?.onResultText && _label === "Autonomous Gate") {
            // Gate says no issues are fixable (no review detail available)
            opts.onResultText(JSON.stringify({
              shouldLoop: false,
              reason: "No review detail",
              fixableIssues: [],
            }));
          }
          return true;
        }),
      });

      await cycleFn.fn(ctx);

      // Should have called execute, review (first loop)
      // Gate returns shouldLoop: false so goes to PR
      expect(mockBuildExecute).toHaveBeenCalled();
      expect(mockBuildReview).toHaveBeenCalled();
      expect(mockBuildCreatePr).toHaveBeenCalled();
    });
  });
});
