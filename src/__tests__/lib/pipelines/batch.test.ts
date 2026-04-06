import { vi, describe, it, expect, beforeEach } from "vitest";
import type { PhaseFunctionContext, PipelinePhase, GroupChild } from "@/types/pipeline";

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

import { buildBatchPipeline } from "@/lib/pipelines/batch";
import { buildUpdateTodoPipeline } from "@/lib/pipelines/update-todo";
import { buildExecutePipeline } from "@/lib/pipelines/execute";
import { buildCreatePrPipeline } from "@/lib/pipelines/create-pr";
import { getOperation } from "@/lib/pipeline-manager";

const mockBuildUpdateTodo = vi.mocked(buildUpdateTodoPipeline);
const mockBuildExecute = vi.mocked(buildExecutePipeline);
const mockBuildCreatePr = vi.mocked(buildCreatePrPipeline);
const mockGetOperation = vi.mocked(getOperation);

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

describe("batch pipeline runSubPhases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOperation.mockReturnValue({
      id: "test-op",
      type: "batch",
      workspace: "test-ws",
      status: "running",
      startedAt: new Date().toISOString(),
    });
    mockBuildExecute.mockResolvedValue([]);
    mockBuildCreatePr.mockResolvedValue([]);
  });

  describe("single phase addDirs/cwd forwarding", () => {
    it("passes addDirs from sub-pipeline phase to ctx.runChild", async () => {
      const subPhase: PipelinePhase = {
        kind: "single",
        label: "Update TODOs",
        prompt: "test-prompt",
        addDirs: ["/ws/test-ws"],
      };
      mockBuildUpdateTodo.mockResolvedValue([subPhase]);

      const phases = buildBatchPipeline({
        mode: "execute-pr",
        startWith: "update-todo",
        workspace: "test-ws",
        instruction: "fix tests",
      });

      const updatePhase = phases[0];
      expect(updatePhase.kind).toBe("function");
      if (updatePhase.kind !== "function") throw new Error("expected function");

      const ctx = createMockCtx();
      await updatePhase.fn(ctx);

      expect(ctx.runChild).toHaveBeenCalledWith(
        "Update TODOs",
        "test-prompt",
        { cwd: undefined, addDirs: ["/ws/test-ws"] },
      );
    });

    it("passes cwd from sub-pipeline phase to ctx.runChild", async () => {
      const subPhase: PipelinePhase = {
        kind: "single",
        label: "Update TODOs",
        prompt: "test-prompt",
        cwd: "/custom/cwd",
        addDirs: ["/ws/test-ws"],
      };
      mockBuildUpdateTodo.mockResolvedValue([subPhase]);

      const phases = buildBatchPipeline({
        mode: "execute-pr",
        startWith: "update-todo",
        workspace: "test-ws",
      });

      const updatePhase = phases[0];
      if (updatePhase.kind !== "function") throw new Error("expected function");

      const ctx = createMockCtx();
      await updatePhase.fn(ctx);

      expect(ctx.runChild).toHaveBeenCalledWith(
        "Update TODOs",
        "test-prompt",
        { cwd: "/custom/cwd", addDirs: ["/ws/test-ws"] },
      );
    });

    it("passes undefined cwd/addDirs when sub-pipeline phase has neither", async () => {
      const subPhase: PipelinePhase = {
        kind: "single",
        label: "Update TODOs",
        prompt: "test-prompt",
      };
      mockBuildUpdateTodo.mockResolvedValue([subPhase]);

      const phases = buildBatchPipeline({
        mode: "execute-pr",
        startWith: "update-todo",
        workspace: "test-ws",
      });

      const updatePhase = phases[0];
      if (updatePhase.kind !== "function") throw new Error("expected function");

      const ctx = createMockCtx();
      await updatePhase.fn(ctx);

      expect(ctx.runChild).toHaveBeenCalledWith(
        "Update TODOs",
        "test-prompt",
        { cwd: undefined, addDirs: undefined },
      );
    });
  });

  describe("group phase forwarding", () => {
    it("passes group children directly to ctx.runChildGroup", async () => {
      const children: GroupChild[] = [
        { label: "repo-a", prompt: "prompt-a", cwd: "/repos/a", addDirs: ["/ws/test-ws"] },
        { label: "repo-b", prompt: "prompt-b", addDirs: ["/ws/test-ws"] },
      ];
      const subPhase: PipelinePhase = {
        kind: "group",
        children,
      };
      mockBuildExecute.mockResolvedValue([subPhase]);

      const phases = buildBatchPipeline({
        mode: "execute-pr",
        startWith: "execute",
        workspace: "test-ws",
      });

      const executePhase = phases[0];
      if (executePhase.kind !== "function") throw new Error("expected function");

      const ctx = createMockCtx();
      await executePhase.fn(ctx);

      expect(ctx.runChildGroup).toHaveBeenCalledWith(children);
    });
  });
});
