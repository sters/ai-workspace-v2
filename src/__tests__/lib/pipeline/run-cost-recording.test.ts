// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OperationEvent } from "@/types/operation";
import type { ClaudeProcess } from "@/types/claude";
import type { ManagedOperation } from "@/lib/pipeline/types";
import { runSinglePhase, runGroupPhase } from "@/lib/pipeline/phase-runners";
import { buildPhaseFunctionContext } from "@/lib/pipeline/context-builder";
import { runClaude } from "@/lib/claude";
import { resolveEffort, resolveModel } from "@/lib/config";
import { insertClaudeRun } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  bufferEvent: vi.fn(),
  stopAutoFlush: vi.fn(),
  startAutoFlush: vi.fn(),
  updateOperationWorkspace: vi.fn(),
  insertClaudeRun: vi.fn(),
}));

vi.mock("@/lib/web-push", () => ({
  sendAskNotification: vi.fn(),
  sendCompletionNotification: vi.fn(),
}));

vi.mock("@/lib/claude", () => ({
  runClaude: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  resolveModel: vi.fn(),
  resolveEffort: vi.fn(),
  getConfig: () => ({ operations: { maxGroupConcurrency: 8 } }),
  getOperationConfig: () => ({ claudeTimeoutMinutes: 20, functionTimeoutMinutes: 3 }),
}));

const resultData = JSON.stringify({
  type: "result",
  subtype: "success",
  total_cost_usd: 0.42,
  duration_ms: 1000,
  num_turns: 3,
  modelUsage: { "claude-opus-5-5": { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, costUSD: 0.42 } },
});

/** A child that reports one costed result, then exits. */
function makeProcessStub(): ClaudeProcess {
  return {
    id: "child",
    onEvent: (handler) => {
      setTimeout(() => {
        const timestamp = new Date().toISOString();
        handler({ type: "output", operationId: "op-1", data: resultData, timestamp } as OperationEvent);
        handler({ type: "complete", operationId: "op-1", data: JSON.stringify({ exitCode: 0 }), timestamp } as OperationEvent);
      }, 0);
    },
    kill: () => {},
    submitAnswer: () => false,
    getResultText: () => undefined,
    getSessionId: () => null,
    getAssistantText: () => "",
  };
}

function makeManaged(): ManagedOperation {
  return {
    operation: {
      id: "op-1",
      type: "review",
      workspace: "ws-1",
      status: "running",
      startedAt: new Date().toISOString(),
      children: [],
      phases: [],
    },
    claudeProcess: null,
    childProcesses: new Map(),
    events: [],
    listeners: new Set(),
    pendingAsks: new Map(),
    hasPendingAsk: false,
    abortController: new AbortController(),
  };
}

const phaseExtra = { phaseIndex: 0, phaseLabel: "Review" };

const expected = {
  operationId: "op-1",
  operationType: "review",
  workspace: "ws-1",
  phaseLabel: "Review",
  childLabel: "reviewer",
  stepType: "code-review",
  effort: "low",
  model: "claude-opus-5-5",
  costUsd: 0.42,
};

describe("run cost recording", () => {
  beforeEach(() => {
    vi.mocked(insertClaudeRun).mockReset();
    vi.mocked(runClaude).mockReset();
    vi.mocked(runClaude).mockImplementation(() => makeProcessStub());
    vi.mocked(resolveModel).mockReturnValue(undefined);
    vi.mocked(resolveEffort).mockReturnValue("low");
  });

  it("records a single phase's result with its step type and effort", async () => {
    await runSinglePhase(makeManaged(), { kind: "single", label: "reviewer", prompt: "p", stepType: "code-review" }, "op-1", 0, 1, phaseExtra);
    expect(insertClaudeRun).toHaveBeenCalledWith(expect.objectContaining(expected));
  });

  it("records each child of a group phase", async () => {
    await runGroupPhase(makeManaged(), {
      kind: "group",
      children: [{ label: "reviewer", prompt: "p", stepType: "code-review" }],
    }, "op-1", 0, 1, phaseExtra);
    expect(insertClaudeRun).toHaveBeenCalledWith(expect.objectContaining(expected));
  });

  it("records children a function phase starts", async () => {
    const ctx = buildPhaseFunctionContext(makeManaged(), "op-1", 0, phaseExtra);
    await ctx.runChild("reviewer", "p", { stepType: "code-review" });
    await ctx.runChildGroup([{ label: "reviewer", prompt: "p", stepType: "code-review" }]);
    expect(insertClaudeRun).toHaveBeenCalledTimes(2);
    expect(vi.mocked(insertClaudeRun).mock.calls.every(([run]) => expect.objectContaining(expected).asymmetricMatch(run))).toBe(true);
  });

  it("keeps the operation running when recording fails", async () => {
    vi.mocked(insertClaudeRun).mockImplementation(() => { throw new Error("disk full"); });
    const ok = await runSinglePhase(makeManaged(), { kind: "single", label: "reviewer", prompt: "p", stepType: "code-review" }, "op-1", 0, 1, phaseExtra);
    expect(ok).toBe(true);
  });
});
