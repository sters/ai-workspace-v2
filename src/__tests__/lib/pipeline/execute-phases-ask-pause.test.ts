import { describe, expect, it, vi } from "bun:test";
import type { PipelinePhase } from "@/types/pipeline";
import type { ManagedOperation } from "@/lib/pipeline/types";
import { executePipelinePhases } from "@/lib/pipeline/execute-phases";
import { setPendingAsk } from "@/lib/pipeline/events";

vi.mock("@/lib/db", () => ({
  bufferEvent: vi.fn(),
  stopAutoFlush: vi.fn(),
  startAutoFlush: vi.fn(),
  updateOperationWorkspace: vi.fn(),
}));
vi.mock("@/lib/web-push", () => ({ sendAskNotification: vi.fn(), sendCompletionNotification: vi.fn() }));
vi.mock("@/lib/operation-store", () => ({ writeOperationLog: vi.fn() }));
vi.mock("@/lib/claude", () => ({ runClaude: vi.fn() }));
vi.mock("@/lib/config", () => ({
  resolveModel: vi.fn(),
  getConfig: vi.fn().mockReturnValue({}),
  getOperationConfig: vi.fn().mockReturnValue({}),
}));

function managedFor(): ManagedOperation {
  return {
    operation: {
      id: "op", type: "verify", workspace: "ws", status: "running", startedAt: new Date().toISOString(),
      children: [], phases: [{ index: 0, label: "Verify", status: "pending" }],
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("phase timeout and questions to a person", () => {
  it("does not count the time a question waits for its answer", async () => {
    const managed = managedFor();
    const phase: PipelinePhase = {
      kind: "function",
      label: "Verify",
      timeoutMs: 100,
      maxRetries: 0,
      fn: async (ctx) => {
        await sleep(30);
        setPendingAsk(managed, true);
        await sleep(200);
        setPendingAsk(managed, false);
        await sleep(30);
        return !ctx.signal.aborted;
      },
    };
    await executePipelinePhases({ managed, phases: [phase], phaseInfos: managed.operation.phases!, operationType: "verify" });
    expect(managed.operation.status).toBe("completed");
  });

  it("still times out on work that runs past the budget", async () => {
    const managed = managedFor();
    const phase: PipelinePhase = {
      kind: "function",
      label: "Verify",
      timeoutMs: 100,
      maxRetries: 0,
      fn: async (ctx) => {
        setPendingAsk(managed, true);
        await sleep(50);
        setPendingAsk(managed, false);
        await sleep(150);
        return !ctx.signal.aborted;
      },
    };
    await executePipelinePhases({ managed, phases: [phase], phaseInfos: managed.operation.phases!, operationType: "verify" });
    expect(managed.operation.status).toBe("failed");
  });
});
