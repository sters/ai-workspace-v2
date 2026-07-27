// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OperationEvent } from "@/types/operation";
import type { ClaudeProcess } from "@/types/claude";
import type { ManagedOperation } from "@/lib/pipeline/types";
import type { PipelinePhaseSingle, PipelinePhaseGroup } from "@/types/pipeline";
import { runSinglePhase, runGroupPhase } from "@/lib/pipeline/phase-runners";
import { buildPhaseFunctionContext } from "@/lib/pipeline/context-builder";
import { runClaude } from "@/lib/claude";
import { resolveEffort, resolveModel } from "@/lib/config";

vi.mock("@/lib/db", () => ({
  bufferEvent: vi.fn(),
  stopAutoFlush: vi.fn(),
  startAutoFlush: vi.fn(),
  updateOperationWorkspace: vi.fn(),
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
}));

/** Minimal ClaudeProcess stub that completes successfully on the next tick. */
function makeProcessStub(): ClaudeProcess {
  let handler: ((event: OperationEvent) => void) | null = null;
  const proc: ClaudeProcess = {
    id: "child",
    onEvent: (h) => {
      handler = h;
      setTimeout(() => {
        handler?.({
          type: "complete",
          operationId: "op-1",
          timestamp: new Date().toISOString(),
        } as OperationEvent);
      }, 0);
    },
    kill: () => {},
    submitAnswer: () => false,
    getResultText: () => undefined,
    getSessionId: () => null,
    getAssistantText: () => "",
  };
  return proc;
}

function makeManaged(): ManagedOperation {
  const managed: ManagedOperation = {
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
  return managed;
}

const phaseExtra = { phaseIndex: 0, phaseLabel: "Phase" };

describe("effort plumbing", () => {
  beforeEach(() => {
    vi.mocked(runClaude).mockReset();
    vi.mocked(runClaude).mockImplementation(() => makeProcessStub());
    vi.mocked(resolveModel).mockReset();
    vi.mocked(resolveModel).mockReturnValue(undefined);
    vi.mocked(resolveEffort).mockReset();
    vi.mocked(resolveEffort).mockReturnValue("xhigh");
  });

  it("passes the resolved effort to runClaude for a single phase", async () => {
    const phase: PipelinePhaseSingle = {
      kind: "single",
      label: "Execute",
      prompt: "do it",
      stepType: "execute",
    };

    await runSinglePhase(makeManaged(), phase, "op-1", 0, 1, phaseExtra);

    expect(resolveEffort).toHaveBeenCalledWith("review", "execute", undefined);
    expect(vi.mocked(runClaude).mock.calls[0][2]).toMatchObject({ effort: "xhigh" });
  });

  it("forwards an explicit per-phase effort override to the resolver", async () => {
    const phase: PipelinePhaseSingle = {
      kind: "single",
      label: "Execute",
      prompt: "do it",
      stepType: "execute",
      effort: "max",
    };

    await runSinglePhase(makeManaged(), phase, "op-1", 0, 1, phaseExtra);

    expect(resolveEffort).toHaveBeenCalledWith("review", "execute", "max");
  });

  it("passes the resolved effort to runClaude for each group child", async () => {
    const phase: PipelinePhaseGroup = {
      kind: "group",
      children: [
        { label: "a", prompt: "p1", stepType: "code-review" },
        { label: "b", prompt: "p2", stepType: "verify-todo", effort: "low" },
      ],
    };

    await runGroupPhase(makeManaged(), phase, "op-1", 0, 1, phaseExtra);

    expect(resolveEffort).toHaveBeenCalledWith("review", "code-review", undefined);
    expect(resolveEffort).toHaveBeenCalledWith("review", "verify-todo", "low");
    for (const call of vi.mocked(runClaude).mock.calls) {
      expect(call[2]).toMatchObject({ effort: "xhigh" });
    }
  });

  it("passes the resolved effort to runClaude from a function phase's runChild", async () => {
    const managed = makeManaged();
    const ctx = buildPhaseFunctionContext(managed, "op-1", 0, phaseExtra);

    await ctx.runChild("Verify", "prompt", { stepType: "verify-readme" });

    expect(resolveEffort).toHaveBeenCalledWith("review", "verify-readme", undefined);
    expect(vi.mocked(runClaude).mock.calls[0][2]).toMatchObject({ effort: "xhigh" });
  });

  it("passes the resolved effort to runClaude from runChildGroup", async () => {
    const managed = makeManaged();
    const ctx = buildPhaseFunctionContext(managed, "op-1", 0, phaseExtra);

    await ctx.runChildGroup([
      { label: "a", prompt: "p1", stepType: "collect-reviews" },
    ]);

    expect(resolveEffort).toHaveBeenCalledWith("review", "collect-reviews", undefined);
    expect(vi.mocked(runClaude).mock.calls[0][2]).toMatchObject({ effort: "xhigh" });
  });

  it("still omits claude options entirely when nothing is configured", async () => {
    vi.mocked(resolveEffort).mockReturnValue(undefined);
    const phase: PipelinePhaseSingle = { kind: "single", label: "Plain", prompt: "p" };

    await runSinglePhase(makeManaged(), phase, "op-1", 0, 1, phaseExtra);

    expect(vi.mocked(runClaude).mock.calls[0][2]).toBeUndefined();
  });
});
