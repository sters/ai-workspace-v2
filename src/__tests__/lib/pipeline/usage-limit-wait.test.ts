// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeProcess } from "@/types/claude";
import type { OperationEvent, OperationPhaseInfo } from "@/types/operation";
import type { PipelinePhase } from "@/types/pipeline";
import type { ManagedOperation } from "@/lib/pipeline/types";
import { runClaude } from "@/lib/claude";
import { getConfig } from "@/lib/config";
import { sendUsageLimitNotification } from "@/lib/web-push";
import { executePipelinePhases } from "@/lib/pipeline/execute-phases";
import { runChildWaitingOutUsageLimit } from "@/lib/pipeline/usage-limit-wait";
import { getOperationSummaries } from "@/lib/pipeline/queries";
import { operations } from "@/lib/pipeline/store";

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
  sendUsageLimitNotification: vi.fn(),
}));

vi.mock("@/lib/operation-store", () => ({
  writeOperationLog: vi.fn(),
}));

vi.mock("@/lib/claude", () => ({
  runClaude: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  resolveModel: vi.fn(),
  resolveEffort: vi.fn(),
  getConfig: vi.fn(),
  getOperationConfig: vi.fn().mockReturnValue({}),
}));

const NOW = new Date("2026-10-29T09:00:00Z").getTime();
const MINUTE = 60_000;

function setWaitOutUsageLimit(enabled: boolean) {
  vi.mocked(getConfig).mockReturnValue({ operations: { waitOutUsageLimit: enabled } } as ReturnType<typeof getConfig>);
}

function makeManaged(phases: OperationPhaseInfo[] = []): ManagedOperation {
  return {
    operation: {
      id: "op-1",
      type: "autonomous",
      workspace: "ws-1",
      status: "running",
      startedAt: new Date().toISOString(),
      children: [],
      phases,
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

function rateLimitEvent(status: "allowed" | "rejected", resetsAtMs: number): OperationEvent {
  return {
    type: "output",
    operationId: "op-1",
    data: JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status, resetsAt: Math.floor(resetsAtMs / 1000), rateLimitType: "five_hour" },
    }),
    timestamp: new Date().toISOString(),
  };
}

/** A process that emits `events` and then exits with `exitCode`, on the next tick. */
function fakeProcess(events: OperationEvent[], exitCode: number): ClaudeProcess {
  return {
    id: "p",
    onEvent: (handler) => {
      setTimeout(() => {
        for (const e of events) handler(e);
        handler({
          type: "complete",
          operationId: "op-1",
          data: JSON.stringify({ exitCode }),
          timestamp: new Date().toISOString(),
        });
      }, 0);
    },
    kill: vi.fn(),
    submitAnswer: vi.fn(() => false),
    getResultText: () => (exitCode === 0 ? "done" : "You've hit your session limit"),
    getSessionId: () => null,
    getAssistantText: () => "",
  };
}

const limited = (resetsAtMs: number) => fakeProcess([rateLimitEvent("rejected", resetsAtMs)], 1);
const succeeds = () => fakeProcess([rateLimitEvent("allowed", NOW + 5 * 60 * MINUTE)], 0);

function statuses(managed: ManagedOperation): string[] {
  return managed.events.filter((e) => e.type === "status").map((e) => e.data);
}

describe("runChildWaitingOutUsageLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setWaitOutUsageLimit(true);
    vi.mocked(sendUsageLimitNotification).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies once when the operation starts waiting and once when it resumes", async () => {
    const managed = makeManaged();
    const spawnA = vi.fn().mockReturnValueOnce(limited(NOW + 30 * MINUTE)).mockReturnValueOnce(succeeds());
    const spawnB = vi.fn().mockReturnValueOnce(limited(NOW + 30 * MINUTE)).mockReturnValueOnce(succeeds());

    const pending = Promise.all([
      runChildWaitingOutUsageLimit(managed, "a", "A", spawnA),
      runChildWaitingOutUsageLimit(managed, "b", "B", spawnB),
    ]);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(vi.mocked(sendUsageLimitNotification).mock.calls).toEqual([
      ["op-1", "ws-1", expect.any(Number)],
    ]);

    await vi.advanceTimersByTimeAsync(40 * MINUTE);
    await pending;
    expect(vi.mocked(sendUsageLimitNotification).mock.calls).toEqual([
      ["op-1", "ws-1", expect.any(Number)],
      ["op-1", "ws-1", null],
    ]);
  });

  it("does not announce a resume when the wait is cancelled", async () => {
    const managed = makeManaged();
    const spawn = vi.fn().mockReturnValue(limited(NOW + 30 * MINUTE));

    const pending = runChildWaitingOutUsageLimit(managed, "c1", "Child", spawn);
    await vi.advanceTimersByTimeAsync(MINUTE);
    managed.abortController.abort();
    await pending;

    expect(vi.mocked(sendUsageLimitNotification).mock.calls).toEqual([
      ["op-1", "ws-1", expect.any(Number)],
    ]);
  });

  it("waits for the reset and runs the child again", async () => {
    const managed = makeManaged();
    const spawn = vi.fn()
      .mockReturnValueOnce(limited(NOW + 30 * MINUTE))
      .mockReturnValueOnce(succeeds());

    const pending = runChildWaitingOutUsageLimit(managed, "c1", "Child", spawn);
    await vi.advanceTimersByTimeAsync(29 * MINUTE);
    expect(spawn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    const result = await pending;

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(statuses(managed).some((s) => /usage limit/i.test(s))).toBe(true);
  });

  it("reports the resume time in the operation summary only while waiting", async () => {
    const managed = makeManaged();
    operations.set(managed.operation.id, managed);
    const summary = () => getOperationSummaries().find((o) => o.id === managed.operation.id);
    const spawn = vi.fn()
      .mockReturnValueOnce(limited(NOW + 30 * MINUTE))
      .mockReturnValueOnce(succeeds());

    try {
      const pending = runChildWaitingOutUsageLimit(managed, "c1", "Child", spawn);
      await vi.advanceTimersByTimeAsync(MINUTE);
      const until = summary()?.usageLimitWaitUntil;
      expect(until && new Date(until).getTime()).toBeGreaterThanOrEqual(NOW + 30 * MINUTE);

      await vi.advanceTimersByTimeAsync(40 * MINUTE);
      await pending;
      expect(summary()?.usageLimitWaitUntil).toBeUndefined();
    } finally {
      operations.delete(managed.operation.id);
    }
  });

  it("does not wait on a failure without a rejected rate-limit event", async () => {
    const managed = makeManaged();
    const spawn = vi.fn().mockReturnValue(
      fakeProcess([rateLimitEvent("allowed", NOW + 30 * MINUTE)], 1),
    );

    const pending = runChildWaitingOutUsageLimit(managed, "c1", "Child", spawn);
    await vi.advanceTimersByTimeAsync(10);
    const result = await pending;

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
  });

  it("does not wait when operations.waitOutUsageLimit is off", async () => {
    setWaitOutUsageLimit(false);
    const managed = makeManaged();
    const spawn = vi.fn().mockReturnValue(limited(NOW + 30 * MINUTE));

    const pending = runChildWaitingOutUsageLimit(managed, "c1", "Child", spawn);
    await vi.advanceTimersByTimeAsync(10);
    const result = await pending;

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
  });

  it("gives up instead of waiting for a reset days away", async () => {
    const managed = makeManaged();
    const spawn = vi.fn().mockReturnValue(limited(NOW + 3 * 24 * 60 * MINUTE));

    const pending = runChildWaitingOutUsageLimit(managed, "c1", "Child", spawn);
    await vi.advanceTimersByTimeAsync(10);
    const result = await pending;

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
  });

  it("stops waiting when the operation is cancelled", async () => {
    const managed = makeManaged();
    const spawn = vi.fn().mockReturnValue(limited(NOW + 30 * MINUTE));

    const pending = runChildWaitingOutUsageLimit(managed, "c1", "Child", spawn);
    await vi.advanceTimersByTimeAsync(MINUTE);
    managed.abortController.abort();
    const result = await pending;

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
  });

  it("stops after a bounded number of waits when the limit keeps rejecting", async () => {
    const managed = makeManaged();
    const spawn = vi.fn().mockImplementation(() => limited(Date.now() + MINUTE));

    const pending = runChildWaitingOutUsageLimit(managed, "c1", "Child", spawn);
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    const result = await pending;

    expect(result.success).toBe(false);
    expect(spawn.mock.calls.length).toBeGreaterThan(1);
    expect(spawn.mock.calls.length).toBeLessThan(10);
  });
});

describe("phase timeout while a child waits out a usage limit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setWaitOutUsageLimit(true);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not count the wait against the phase budget", async () => {
    vi.mocked(runClaude)
      .mockReturnValueOnce(limited(NOW + 30 * MINUTE))
      .mockReturnValueOnce(succeeds());

    const phase: PipelinePhase = {
      kind: "function",
      label: "Cycle 1: Execute",
      timeoutMs: 10 * MINUTE,
      maxRetries: 0,
      fn: (ctx) => ctx.runChild("executor", "do it"),
    };
    const phaseInfos: OperationPhaseInfo[] = [{ index: 0, label: phase.label, status: "pending" }];
    const managed = makeManaged(phaseInfos);

    const pending = executePipelinePhases({
      managed,
      phases: [phase],
      phaseInfos,
      operationType: "autonomous",
    });
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    await pending;

    expect(runClaude).toHaveBeenCalledTimes(2);
    expect(managed.operation.status).toBe("completed");
  });
});
