// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OperationPhaseInfo } from "@/types/operation";
import type { PipelinePhase } from "@/types/pipeline";
import type { ManagedOperation } from "@/lib/pipeline/types";
import { executePipelinePhases } from "@/lib/pipeline/execute-phases";

// ---------------------------------------------------------------------------
// Mock dependencies that talk to SQLite or external services
// ---------------------------------------------------------------------------

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

vi.mock("@/lib/operation-store", () => ({
  writeOperationLog: vi.fn(),
}));

vi.mock("@/lib/claude", () => ({
  runClaude: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  resolveModel: vi.fn(),
  getConfig: vi.fn().mockReturnValue({}),
  getOperationConfig: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManagedOperation(phases: PipelinePhase[]): {
  managed: ManagedOperation;
  phaseInfos: OperationPhaseInfo[];
  /** All events captured via listener (survives markComplete clearing events[]). */
  capturedEvents: { type: string; data: string }[];
} {
  const phaseInfos: OperationPhaseInfo[] = phases.map((_, i) => ({
    index: i,
    label: `Phase ${i + 1}`,
    status: "pending" as const,
  }));

  const capturedEvents: { type: string; data: string }[] = [];

  const managed: ManagedOperation = {
    operation: {
      id: "test-op-1",
      type: "execute",
      workspace: "test-ws",
      status: "running",
      startedAt: new Date().toISOString(),
      children: [],
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

  // Capture events via listener (survives markComplete's events.length = 0)
  managed.listeners.add((event) => {
    capturedEvents.push({ type: event.type, data: event.data });
  });

  return { managed, phaseInfos, capturedEvents };
}

function makeFunctionPhase(
  fn: () => Promise<boolean>,
  opts?: { maxRetries?: number; retryDelayMs?: number; timeoutMs?: number },
): PipelinePhase {
  return {
    kind: "function",
    label: "Test Phase",
    fn: async () => fn(),
    ...opts,
  };
}

/** Collect status event messages from captured events. */
function statusMessages(capturedEvents: { type: string; data: string }[]): string[] {
  return capturedEvents
    .filter((e) => e.type === "status")
    .map((e) => e.data);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("execute-phases retry logic", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("no retry when maxRetries is explicitly 0", async () => {
    let callCount = 0;
    const phase = makeFunctionPhase(async () => {
      callCount++;
      return false;
    }, { maxRetries: 0 });

    const { managed, phaseInfos, capturedEvents } = makeManagedOperation([phase]);
    await executePipelinePhases({
      managed,
      phases: [phase],
      phaseInfos,
      operationType: "execute",
    });

    expect(callCount).toBe(1);
    expect(managed.operation.status).toBe("failed");
    expect(phaseInfos[0].status).toBe("failed");
    // No retry events
    const retryMsgs = statusMessages(capturedEvents).filter((m) => m.includes("retry"));
    expect(retryMsgs).toHaveLength(0);
  });

  it("default maxRetries is 2 (retries twice)", async () => {
    let callCount = 0;
    const phase = makeFunctionPhase(async () => {
      callCount++;
      return false;
    }, { retryDelayMs: 10 }); // no maxRetries specified — uses default

    const { managed, phaseInfos } = makeManagedOperation([phase]);
    await executePipelinePhases({
      managed,
      phases: [phase],
      phaseInfos,
      operationType: "execute",
    });

    // 1 initial + 2 retries (default) = 3 total
    expect(callCount).toBe(3);
    expect(managed.operation.status).toBe("failed");
  });

  it("no retry when phase succeeds on first try", async () => {
    let callCount = 0;
    const phase = makeFunctionPhase(
      async () => {
        callCount++;
        return true;
      },
      { maxRetries: 2, retryDelayMs: 10 },
    );

    const { managed, phaseInfos, capturedEvents } = makeManagedOperation([phase]);
    await executePipelinePhases({
      managed,
      phases: [phase],
      phaseInfos,
      operationType: "execute",
    });

    expect(callCount).toBe(1);
    expect(managed.operation.status).toBe("completed");
    // No "retrying" events should be emitted
    const retryingEvents = statusMessages(capturedEvents).filter((m) => m.includes("retrying"));
    expect(retryingEvents).toHaveLength(0);
  });

  it("retries and succeeds on second attempt", async () => {
    let callCount = 0;
    const phase = makeFunctionPhase(
      async () => {
        callCount++;
        return callCount >= 2; // fail first, succeed second
      },
      { maxRetries: 2, retryDelayMs: 10 },
    );

    const { managed, phaseInfos } = makeManagedOperation([phase]);
    await executePipelinePhases({
      managed,
      phases: [phase],
      phaseInfos,
      operationType: "execute",
    });

    expect(callCount).toBe(2);
    expect(managed.operation.status).toBe("completed");
    expect(phaseInfos[0].status).toBe("completed");
    expect(phaseInfos[0].retryAttempt).toBe(1);
  });

  it("exhausts all retries then fails", async () => {
    let callCount = 0;
    const phase = makeFunctionPhase(
      async () => {
        callCount++;
        return false;
      },
      { maxRetries: 2, retryDelayMs: 10 },
    );

    const { managed, phaseInfos } = makeManagedOperation([phase]);
    await executePipelinePhases({
      managed,
      phases: [phase],
      phaseInfos,
      operationType: "execute",
    });

    // 1 initial + 2 retries = 3 total
    expect(callCount).toBe(3);
    expect(managed.operation.status).toBe("failed");
    expect(phaseInfos[0].status).toBe("failed");
  });

  it("emits retrying status events between retries", async () => {
    let callCount = 0;
    const phase = makeFunctionPhase(
      async () => {
        callCount++;
        return callCount >= 3; // fail twice, succeed third
      },
      { maxRetries: 2, retryDelayMs: 10 },
    );

    const { managed, phaseInfos, capturedEvents } = makeManagedOperation([phase]);
    await executePipelinePhases({
      managed,
      phases: [phase],
      phaseInfos,
      operationType: "execute",
    });

    expect(callCount).toBe(3);

    // Should have "retrying" phase update events
    const phaseUpdateEvents = statusMessages(capturedEvents).filter((m) =>
      m.startsWith("__phaseUpdate:") && m.includes('"retrying"'),
    );
    expect(phaseUpdateEvents.length).toBeGreaterThanOrEqual(1);

    // Should have retry status messages
    const retryMessages = statusMessages(capturedEvents).filter((m) =>
      m.includes("retry") && !m.startsWith("__phaseUpdate:"),
    );
    expect(retryMessages).toHaveLength(2); // retry 1/2, retry 2/2
  });

  it("respects retryDelayMs between attempts", async () => {
    const timestamps: number[] = [];
    let callCount = 0;
    const phase = makeFunctionPhase(
      async () => {
        callCount++;
        timestamps.push(Date.now());
        return callCount >= 2;
      },
      { maxRetries: 1, retryDelayMs: 100 },
    );

    const { managed, phaseInfos } = makeManagedOperation([phase]);
    await executePipelinePhases({
      managed,
      phases: [phase],
      phaseInfos,
      operationType: "execute",
    });

    expect(timestamps).toHaveLength(2);
    const elapsed = timestamps[1] - timestamps[0];
    // Should have waited at least ~100ms (allow some tolerance)
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it("abort during retry delay cancels retry", async () => {
    let callCount = 0;
    const phase = makeFunctionPhase(
      async () => {
        callCount++;
        return false;
      },
      { maxRetries: 2, retryDelayMs: 5000 },
    );

    const { managed, phaseInfos } = makeManagedOperation([phase]);

    // Abort after 50ms (during the retry delay)
    setTimeout(() => managed.abortController.abort(), 50);

    await executePipelinePhases({
      managed,
      phases: [phase],
      phaseInfos,
      operationType: "execute",
    });

    // Should have run once and then been aborted during delay
    expect(callCount).toBe(1);
    expect(managed.operation.status).toBe("failed");
  });

  it("tracks retryAttempt and maxRetries in phaseInfos", async () => {
    let callCount = 0;
    const phase = makeFunctionPhase(
      async () => {
        callCount++;
        return callCount >= 3;
      },
      { maxRetries: 3, retryDelayMs: 10 },
    );

    const { managed, phaseInfos } = makeManagedOperation([phase]);
    await executePipelinePhases({
      managed,
      phases: [phase],
      phaseInfos,
      operationType: "execute",
    });

    expect(phaseInfos[0].maxRetries).toBe(3);
    expect(phaseInfos[0].retryAttempt).toBe(2); // 0-indexed: attempt 2 = 3rd try
  });

  it("each retry gets a fresh timeout", async () => {
    let callCount = 0;
    const phase = makeFunctionPhase(
      async () => {
        callCount++;
        if (callCount === 1) {
          // First attempt: take a long time (will timeout)
          await new Promise((resolve) => setTimeout(resolve, 200));
          return true;
        }
        // Second attempt: fast
        return true;
      },
      { maxRetries: 1, retryDelayMs: 10, timeoutMs: 100 },
    );

    const { managed, phaseInfos } = makeManagedOperation([phase]);
    await executePipelinePhases({
      managed,
      phases: [phase],
      phaseInfos,
      operationType: "execute",
    });

    expect(callCount).toBe(2);
    expect(managed.operation.status).toBe("completed");
  });

  it("onPhaseComplete is only called after retries are exhausted", async () => {
    let callCount = 0;
    const phase = makeFunctionPhase(
      async () => {
        callCount++;
        return false;
      },
      { maxRetries: 2, retryDelayMs: 10 },
    );

    const onPhaseComplete = vi.fn().mockReturnValue("continue");

    const { managed, phaseInfos } = makeManagedOperation([phase]);
    await executePipelinePhases({
      managed,
      phases: [phase],
      phaseInfos,
      operationType: "execute",
      pipelineOptions: { onPhaseComplete },
    });

    // Phase was called 3 times (1 + 2 retries)
    expect(callCount).toBe(3);
    // onPhaseComplete should be called only once (after all retries exhausted)
    expect(onPhaseComplete).toHaveBeenCalledTimes(1);
    expect(onPhaseComplete).toHaveBeenCalledWith(0, phase, false);
  });

  it("second phase runs after first phase retries and succeeds", async () => {
    let phase1Calls = 0;
    let phase2Called = false;
    const phase1 = makeFunctionPhase(
      async () => {
        phase1Calls++;
        return phase1Calls >= 2;
      },
      { maxRetries: 1, retryDelayMs: 10 },
    );
    const phase2 = makeFunctionPhase(async () => {
      phase2Called = true;
      return true;
    });

    const phases = [phase1, phase2];
    const { managed, phaseInfos } = makeManagedOperation(phases);
    await executePipelinePhases({
      managed,
      phases,
      phaseInfos,
      operationType: "execute",
    });

    expect(phase1Calls).toBe(2);
    expect(phase2Called).toBe(true);
    expect(managed.operation.status).toBe("completed");
  });

  it("second phase is skipped when first phase retries are exhausted", async () => {
    let phase2Called = false;
    const phase1 = makeFunctionPhase(async () => false, {
      maxRetries: 1,
      retryDelayMs: 10,
    });
    const phase2 = makeFunctionPhase(async () => {
      phase2Called = true;
      return true;
    });

    const phases = [phase1, phase2];
    const { managed, phaseInfos } = makeManagedOperation(phases);
    await executePipelinePhases({
      managed,
      phases,
      phaseInfos,
      operationType: "execute",
    });

    expect(phase2Called).toBe(false);
    expect(managed.operation.status).toBe("failed");
  });
});
