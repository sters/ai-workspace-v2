/**
 * Tests for pipeline-manager GC and concurrency logic.
 * We test the exported functions directly by manipulating the global store.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  startOperationPipeline,
  getOperations,
  killOperation,
  subscribeToOperation,
  ConcurrencyLimitError,
  MAX_CONCURRENT_OPERATIONS,
  DEFAULT_CLAUDE_TIMEOUT_MS,
  DEFAULT_FUNCTION_TIMEOUT_MS,
} from "@/lib/pipeline-manager";

// Mock the Claude runner so we don't spawn real processes
vi.mock("@/lib/claude", () => ({
  runClaude: vi.fn(() => ({
    id: "mock",
    onEvent: vi.fn(),
    kill: vi.fn(),
    submitAnswer: vi.fn(),
    getResultText: () => undefined,
  })),
}));

// Access globalThis store for direct manipulation
function getGlobalOps(): Map<string, unknown> {
  const g = globalThis as unknown as { __aiWorkspaceOps?: Map<string, unknown> };
  return g.__aiWorkspaceOps!;
}

describe("pipeline-manager GC", () => {
  beforeEach(() => {
    // Clear all operations before each test
    getGlobalOps().clear();
  });

  it("markComplete releases references", async () => {
    // Start a simple function-phase pipeline that completes immediately
    const op = startOperationPipeline("init", "test", [
      {
        kind: "function",
        label: "test",
        fn: async () => true,
      },
    ]);

    // Wait for the async pipeline to complete
    await new Promise((r) => setTimeout(r, 50));

    const managed = getGlobalOps().get(op.id) as {
      childProcesses: Map<string, unknown>;
      pendingAsks: Map<string, unknown>;
      listeners: Set<unknown>;
      claudeProcess: unknown;
      completedAt?: number;
    };

    expect(managed).toBeDefined();
    expect(managed.completedAt).toBeGreaterThan(0);
    expect(managed.childProcesses.size).toBe(0);
    expect(managed.pendingAsks.size).toBe(0);
    expect(managed.listeners.size).toBe(0);
    expect(managed.claudeProcess).toBeNull();
  });

  it("GC removes old completed operations on next start", async () => {
    // Insert a fake completed operation with old completedAt
    const ops = getGlobalOps();
    ops.set("old-1", {
      operation: { id: "old-1", type: "init", workspace: "test", status: "completed", startedAt: "" },
      claudeProcess: null,
      childProcesses: new Map(),
      events: [],
      listeners: new Set(),
      pendingAsks: new Map(),
      abortController: new AbortController(),
      completedAt: Date.now() - 31 * 60 * 1000, // 31 minutes ago
    });

    expect(ops.has("old-1")).toBe(true);

    // Starting a new pipeline triggers GC
    startOperationPipeline("init", "test2", [
      { kind: "function", label: "test", fn: async () => true },
    ]);

    expect(ops.has("old-1")).toBe(false);
  });

  it("getOperations triggers GC", async () => {
    const ops = getGlobalOps();
    ops.set("old-2", {
      operation: { id: "old-2", type: "init", workspace: "test", status: "completed", startedAt: "" },
      claudeProcess: null,
      childProcesses: new Map(),
      events: [],
      listeners: new Set(),
      pendingAsks: new Map(),
      abortController: new AbortController(),
      completedAt: Date.now() - 31 * 60 * 1000,
    });

    const result = getOperations();
    expect(result.find((op) => op.id === "old-2")).toBeUndefined();
  });
});

describe("pipeline-manager concurrency", () => {
  beforeEach(() => {
    getGlobalOps().clear();
  });

  it("throws ConcurrencyLimitError when too many operations are running", () => {
    const ops = getGlobalOps();

    // Fill up with running operations
    for (let i = 0; i < MAX_CONCURRENT_OPERATIONS; i++) {
      ops.set(`running-${i}`, {
        operation: { id: `running-${i}`, type: "init", workspace: "test", status: "running", startedAt: "" },
        claudeProcess: null,
        childProcesses: new Map(),
        events: [],
        listeners: new Set(),
        pendingAsks: new Map(),
        abortController: new AbortController(),
      });
    }

    expect(() => {
      startOperationPipeline("init", "one-too-many", [
        { kind: "function", label: "test", fn: async () => true },
      ]);
    }).toThrow(ConcurrencyLimitError);
  });

  it("allows new operations when completed ones exist", () => {
    const ops = getGlobalOps();

    // Add completed operations (should not count toward limit)
    for (let i = 0; i < MAX_CONCURRENT_OPERATIONS + 5; i++) {
      ops.set(`completed-${i}`, {
        operation: { id: `completed-${i}`, type: "init", workspace: "test", status: "completed", startedAt: "" },
        claudeProcess: null,
        childProcesses: new Map(),
        events: [],
        listeners: new Set(),
        pendingAsks: new Map(),
        abortController: new AbortController(),
        completedAt: Date.now(),
      });
    }

    // This should succeed since there are no running operations
    expect(() => {
      startOperationPipeline("init", "ok", [
        { kind: "function", label: "test", fn: async () => true },
      ]);
    }).not.toThrow();
  });
});

describe("pipeline-manager killOperation", () => {
  beforeEach(() => {
    getGlobalOps().clear();
  });

  it("killOperation unblocks pending emitAsk and marks operation as failed", async () => {
    let askCalled = false;

    const op = startOperationPipeline("workspace-prune", "test", [
      {
        kind: "function",
        label: "test-ask",
        fn: async (ctx) => {
          askCalled = true;
          // This emitAsk will block until answered or cancelled
          await ctx.emitAsk([
            {
              question: "Proceed?",
              options: [
                { label: "Yes", description: "Continue" },
                { label: "No", description: "Cancel" },
              ],
            },
          ]);
          return true;
        },
      },
    ]);

    // Wait for the pipeline to reach the emitAsk
    await new Promise((r) => setTimeout(r, 50));
    expect(askCalled).toBe(true);
    expect(op.status).toBe("running");

    // Kill the operation
    const killed = killOperation(op.id);
    expect(killed).toBe(true);

    // Wait for the pipeline to unwind after the abort
    await new Promise((r) => setTimeout(r, 50));

    expect(op.status).toBe("failed");
  });

  it("killOperation on already completed operation returns false", async () => {
    const op = startOperationPipeline("init", "test", [
      { kind: "function", label: "quick", fn: async () => true },
    ]);

    await new Promise((r) => setTimeout(r, 50));
    expect(op.status).toBe("completed");

    const killed = killOperation(op.id);
    expect(killed).toBe(false);
  });
});

describe("pipeline-manager phase timeout", () => {
  beforeEach(() => {
    getGlobalOps().clear();
  });

  it("function phase times out and fails the pipeline", async () => {
    // Capture events via subscription since they may be cleared from memory after completion
    const capturedEvents: Array<{ data: string }> = [];

    const op = startOperationPipeline("workspace-prune", "test", [
      {
        kind: "function",
        label: "slow-fn",
        timeoutMs: 50, // very short timeout
        fn: async (ctx) => {
          // Block on emitAsk which respects the abort signal
          await ctx.emitAsk([
            {
              question: "Wait forever?",
              options: [
                { label: "Yes", description: "yes" },
                { label: "No", description: "no" },
              ],
            },
          ]);
          return true;
        },
      },
    ]);

    subscribeToOperation(op.id, (event) => {
      capturedEvents.push(event);
    });

    // Wait for the timeout to fire and the pipeline to complete
    await new Promise((r) => setTimeout(r, 200));

    expect(op.status).toBe("failed");

    // Verify the timeout message was emitted
    const timedOutEvent = capturedEvents.find((e) =>
      e.data.includes("timed out after 50ms"),
    );
    expect(timedOutEvent).toBeDefined();
  });

  it("uses correct default timeouts for each phase kind", () => {
    expect(DEFAULT_CLAUDE_TIMEOUT_MS).toBe(20 * 60 * 1000);
    expect(DEFAULT_FUNCTION_TIMEOUT_MS).toBe(3 * 60 * 1000);
  });
});
