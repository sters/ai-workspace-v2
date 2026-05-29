// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OperationEvent, OperationPhaseInfo } from "@/types/operation";
import type { PipelinePhase } from "@/types/pipeline";
import type { ManagedOperation } from "@/lib/pipeline/types";
import { executePipelinePhases } from "@/lib/pipeline/execute-phases";

vi.mock("@/lib/db", () => ({
  bufferEvent: vi.fn(),
  stopAutoFlush: vi.fn(),
  startAutoFlush: vi.fn(),
  updateOperationWorkspace: vi.fn(),
  updateOperationMeta: vi.fn(),
}));

vi.mock("@/lib/web-push", () => ({
  sendAskNotification: vi.fn(),
  sendCompletionNotification: vi.fn(),
}));

vi.mock("@/lib/operation-store", () => ({
  writeOperationLog: vi.fn(),
}));

vi.mock("@/lib/claude", () => ({
  runClaude: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  resolveModel: vi.fn(),
  getConfig: vi.fn().mockReturnValue({}),
  getOperationConfig: vi.fn().mockReturnValue({
    claudeTimeoutMinutes: 5,
    functionTimeoutMinutes: 5,
  }),
}));

function makeManagedOperation(phases: PipelinePhase[]): {
  managed: ManagedOperation;
  phaseInfos: OperationPhaseInfo[];
  capturedEvents: OperationEvent[];
} {
  const phaseInfos: OperationPhaseInfo[] = phases.map((p, i) => ({
    index: i,
    label: p.kind === "group" ? `Phase ${i + 1}` : p.label,
    status: "pending" as const,
  }));

  const capturedEvents: OperationEvent[] = [];

  const managed: ManagedOperation = {
    operation: {
      id: "test-op-append",
      type: "autonomous",
      workspace: "test-ws",
      status: "running",
      startedAt: new Date().toISOString(),
      children: [],
      // Mirrors orchestrator.ts:53 — same array reference as phaseInfos.
      phases: phaseInfos,
    },
    claudeProcess: null,
    childProcesses: new Map(),
    events: [],
    listeners: new Set(),
    pendingAsks: new Map(),
    hasPendingAsk: false,
    abortController: new AbortController(),
  };

  managed.listeners.add((event) => {
    capturedEvents.push(event);
  });

  return { managed, phaseInfos, capturedEvents };
}

describe("execute-phases appendPhases", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not duplicate entries when operation.phases is the same array as phaseInfos", async () => {
    // Repro of the bug: autonomous's Gate function phase appends [UpdateTodo, Exec, Review, Gate].
    // Before the fix, each appended phase was pushed twice (once to phaseInfos, once to
    // operation.phases which is the same array), so phaseInfos.length grew by 8 instead of 4.
    const initialPhase: PipelinePhase = {
      kind: "function",
      label: "Initial",
      fn: async (ctx) => {
        ctx.appendPhases([
          { kind: "function", label: "Appended 1", fn: async () => true },
          { kind: "function", label: "Appended 2", fn: async () => true },
          { kind: "function", label: "Appended 3", fn: async () => true },
          { kind: "function", label: "Appended 4", fn: async () => true },
        ]);
        return true;
      },
    };

    const phases: PipelinePhase[] = [initialPhase];
    const { managed, phaseInfos } = makeManagedOperation(phases);

    await executePipelinePhases({
      managed,
      phases,
      phaseInfos,
      operationType: "autonomous",
    });

    // 1 initial + 4 appended = 5 entries. Bug would produce 1 + 8 = 9.
    expect(phaseInfos).toHaveLength(5);
    expect(phaseInfos.map((p) => p.label)).toEqual([
      "Initial",
      "Appended 1",
      "Appended 2",
      "Appended 3",
      "Appended 4",
    ]);
  });

  it("tags each phase's events with the phase's own label after appendPhases", async () => {
    // Bug symptom: after a function phase appended more phases, every subsequent
    // phase's events were tagged with the *previous* phase's label (off-by-one
    // shift caused by the duplicated phaseInfos entries).
    const phases: PipelinePhase[] = [
      {
        kind: "function",
        label: "Gate",
        fn: async (ctx) => {
          ctx.appendPhases([
            { kind: "function", label: "UpdateTodo", fn: async () => true },
            { kind: "function", label: "NextExecute", fn: async () => true },
            { kind: "function", label: "NextReview", fn: async () => true },
            { kind: "function", label: "CreatePR", fn: async () => true },
          ]);
          return true;
        },
      },
    ];

    const { managed, phaseInfos, capturedEvents } = makeManagedOperation(phases);

    await executePipelinePhases({
      managed,
      phases,
      phaseInfos,
      operationType: "autonomous",
    });

    // Pull every "running" __phaseUpdate event and check phaseIndex → phaseLabel mapping.
    const runningUpdates = capturedEvents
      .filter((e) => e.type === "status" && e.data.startsWith("__phaseUpdate:"))
      .map((e) => JSON.parse(e.data.slice("__phaseUpdate:".length)) as {
        phaseIndex: number;
        phaseLabel: string;
        phaseStatus: string;
      })
      .filter((u) => u.phaseStatus === "running");

    expect(runningUpdates).toEqual([
      { phaseIndex: 0, phaseLabel: "Gate", phaseStatus: "running" },
      { phaseIndex: 1, phaseLabel: "UpdateTodo", phaseStatus: "running" },
      { phaseIndex: 2, phaseLabel: "NextExecute", phaseStatus: "running" },
      { phaseIndex: 3, phaseLabel: "NextReview", phaseStatus: "running" },
      { phaseIndex: 4, phaseLabel: "CreatePR", phaseStatus: "running" },
    ]);

    // CreatePR ran at phaseIndex=4, so its function-phase emitStatus events must
    // carry phaseLabel="CreatePR" (this is what the Slack notifier filters on).
    const createPrPhaseLabels = new Set(
      capturedEvents
        .filter((e) => e.type === "status" && !e.data.startsWith("__phaseUpdate:") && e.phaseIndex === 4)
        .map((e) => e.phaseLabel),
    );
    expect(createPrPhaseLabels).toEqual(new Set(["CreatePR"]));
  });

  it("every __phaseUpdate event's (phaseIndex, phaseLabel) matches phases[phaseIndex].label", async () => {
    // Stronger invariant: across pending / running / completed status emissions,
    // the label in every __phaseUpdate must match the label of the phase that
    // actually sits at that index. Guards against any future drift between
    // phaseInfos and the pipeline's PipelinePhase[] array, not just the
    // duplicate-push bug above.
    const phases: PipelinePhase[] = [
      {
        kind: "function",
        label: "Cycle 1: Gate",
        fn: async (ctx) => {
          ctx.appendPhases([
            { kind: "function", label: "Cycle 1: Update TODO", fn: async () => true },
            { kind: "function", label: "Cycle 2: Execute", fn: async () => true },
            {
              kind: "function",
              label: "Cycle 2: Gate",
              fn: async (innerCtx) => {
                innerCtx.appendPhases([
                  { kind: "function", label: "Create PR", fn: async () => true },
                ]);
                return true;
              },
            },
          ]);
          return true;
        },
      },
    ];

    const { managed, phaseInfos, capturedEvents } = makeManagedOperation(phases);

    await executePipelinePhases({
      managed,
      phases,
      phaseInfos,
      operationType: "autonomous",
    });

    const updates = capturedEvents
      .filter((e) => e.type === "status" && e.data.startsWith("__phaseUpdate:"))
      .map((e) => JSON.parse(e.data.slice("__phaseUpdate:".length)) as {
        phaseIndex: number;
        phaseLabel: string;
        phaseStatus: string;
      });

    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
      const phase = phases[u.phaseIndex];
      expect(phase, `phases[${u.phaseIndex}] missing`).toBeDefined();
      const expectedLabel = phase.kind === "group" ? `Phase ${u.phaseIndex + 1}` : phase.label;
      expect(
        u.phaseLabel,
        `__phaseUpdate at index=${u.phaseIndex} status=${u.phaseStatus} expected label "${expectedLabel}" but got "${u.phaseLabel}"`,
      ).toBe(expectedLabel);
    }

    // Sanity: pipeline ended with 5 phases (1 initial + 3 from first append + 1 from nested append).
    expect(phases).toHaveLength(5);
    expect(phaseInfos).toHaveLength(5);
  });
});
