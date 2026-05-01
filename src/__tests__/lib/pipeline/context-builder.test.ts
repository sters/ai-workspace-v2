// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OperationEvent } from "@/types/operation";
import type { ManagedOperation } from "@/lib/pipeline/types";
import { buildPhaseFunctionContext } from "@/lib/pipeline/context-builder";

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

describe("buildPhaseFunctionContext — childLabel attachment", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("emitStatus tags events with childLabel = phaseLabel", () => {
    const { managed, events } = makeManaged();
    const ctx = buildPhaseFunctionContext(managed, "op-1", 2, {
      phaseIndex: 2,
      phaseLabel: "Verify constraints",
    });

    ctx.emitStatus("[repo] Running: Lint");

    const statusEvents = events.filter((e) => e.type === "status");
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0].childLabel).toBe("Verify constraints");
    expect(statusEvents[0].phaseIndex).toBe(2);
    expect(statusEvents[0].phaseLabel).toBe("Verify constraints");
  });

  it("emitResult tags output events with childLabel = phaseLabel", () => {
    const { managed, events } = makeManaged();
    const ctx = buildPhaseFunctionContext(managed, "op-1", 2, {
      phaseIndex: 2,
      phaseLabel: "Verify constraints",
    });

    ctx.emitResult("All constraints passed");

    const outputs = events.filter((e) => e.type === "output");
    expect(outputs).toHaveLength(1);
    expect(outputs[0].childLabel).toBe("Verify constraints");
    expect(outputs[0].phaseIndex).toBe(2);
  });

  it("emitTerminal tags terminal events with childLabel = phaseLabel", () => {
    const { managed, events } = makeManaged();
    const ctx = buildPhaseFunctionContext(managed, "op-1", 0, {
      phaseIndex: 0,
      phaseLabel: "Setup workspace",
    });

    ctx.emitTerminal("some terminal output");

    const terms = events.filter((e) => e.type === "terminal");
    expect(terms).toHaveLength(1);
    expect(terms[0].childLabel).toBe("Setup workspace");
  });

  it("emitAsk tags assistant ask events with childLabel = phaseLabel", () => {
    const { managed, events } = makeManaged();
    const ctx = buildPhaseFunctionContext(managed, "op-1", 1, {
      phaseIndex: 1,
      phaseLabel: "Best-of-N: Setup",
    });

    // Don't await — we just want to inspect the emitted assistant message
    void ctx.emitAsk([
      { question: "Use Best-of-N?", options: [{ label: "Yes" }, { label: "No" }] },
    ]);

    const outputs = events.filter((e) => e.type === "output");
    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs[0].childLabel).toBe("Best-of-N: Setup");
  });

  it("setWorkspace status event also carries childLabel", () => {
    const { managed, events } = makeManaged();
    const ctx = buildPhaseFunctionContext(managed, "op-1", 0, {
      phaseIndex: 0,
      phaseLabel: "Setup workspace",
    });

    ctx.setWorkspace("new-ws");

    const setWsEvent = events.find(
      (e) => e.type === "status" && e.data.startsWith("__setWorkspace:"),
    );
    expect(setWsEvent).toBeDefined();
    expect(setWsEvent?.childLabel).toBe("Setup workspace");
  });
});
