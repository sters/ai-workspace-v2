// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { OperationEvent } from "@/types/operation";
import type { ManagedOperation } from "@/lib/pipeline/types";
import type { PipelinePhaseFunction } from "@/types/pipeline";
import { runFunctionPhase } from "@/lib/pipeline/phase-runners";

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
}));

function makeManaged(): {
  managed: ManagedOperation;
  events: OperationEvent[];
} {
  const events: OperationEvent[] = [];
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
  managed.listeners.add((e) => events.push(e));
  return { managed, events };
}

describe("runFunctionPhase — child-group completion marker", () => {
  it("emits a complete event tagged with childLabel = phase.label when the function returns true", async () => {
    const { managed, events } = makeManaged();
    const phase: PipelinePhaseFunction = {
      kind: "function",
      label: "Discover repo constraints",
      fn: async () => true,
    };

    const ok = await runFunctionPhase(managed, phase, "op-1", 2, 10, {
      phaseIndex: 2,
      phaseLabel: "Discover repo constraints",
    });

    expect(ok).toBe(true);
    const completes = events.filter(
      (e) => e.type === "complete" && e.childLabel === "Discover repo constraints",
    );
    expect(completes).toHaveLength(1);
    const data = JSON.parse(completes[0].data);
    expect(data.exitCode).toBe(0);
    expect(completes[0].phaseIndex).toBe(2);
    expect(completes[0].phaseLabel).toBe("Discover repo constraints");
  });

  it("emits a complete event with exitCode != 0 when the function returns false", async () => {
    const { managed, events } = makeManaged();
    const phase: PipelinePhaseFunction = {
      kind: "function",
      label: "Plan TODO items",
      fn: async () => false,
    };

    const ok = await runFunctionPhase(managed, phase, "op-1", 0, 1, {
      phaseIndex: 0,
      phaseLabel: "Plan TODO items",
    });

    expect(ok).toBe(false);
    const completes = events.filter(
      (e) => e.type === "complete" && e.childLabel === "Plan TODO items",
    );
    expect(completes).toHaveLength(1);
    const data = JSON.parse(completes[0].data);
    expect(data.exitCode).not.toBe(0);
  });

  it("emits a complete event with exitCode != 0 when the function throws", async () => {
    const { managed, events } = makeManaged();
    const phase: PipelinePhaseFunction = {
      kind: "function",
      label: "Setup workspace",
      fn: async () => {
        throw new Error("boom");
      },
    };

    const ok = await runFunctionPhase(managed, phase, "op-1", 0, 1, {
      phaseIndex: 0,
      phaseLabel: "Setup workspace",
    });

    expect(ok).toBe(false);
    const completes = events.filter(
      (e) => e.type === "complete" && e.childLabel === "Setup workspace",
    );
    expect(completes).toHaveLength(1);
    const data = JSON.parse(completes[0].data);
    expect(data.exitCode).not.toBe(0);
  });
});
