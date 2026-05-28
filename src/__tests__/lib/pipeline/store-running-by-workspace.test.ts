// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { operations, findRunningOpByWorkspace, interjectsInFlight } from "@/lib/pipeline/store";
import type { ManagedOperation } from "@/lib/pipeline/types";
import type { Operation, OperationType } from "@/types/operation";

function makeManaged(
  id: string,
  workspace: string,
  status: Operation["status"],
  type: OperationType = "execute",
): ManagedOperation {
  return {
    operation: {
      id,
      type,
      workspace,
      status,
      startedAt: new Date().toISOString(),
      children: [],
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

describe("findRunningOpByWorkspace", () => {
  beforeEach(() => {
    operations.clear();
    interjectsInFlight.clear();
  });

  it("returns undefined when no op exists for workspace", () => {
    expect(findRunningOpByWorkspace("missing")).toBeUndefined();
  });

  it("returns the running op for the workspace", () => {
    const managed = makeManaged("op-1", "ws-a", "running");
    operations.set("op-1", managed);
    expect(findRunningOpByWorkspace("ws-a")?.operation.id).toBe("op-1");
  });

  it("ignores completed ops", () => {
    operations.set("op-1", makeManaged("op-1", "ws-a", "completed"));
    expect(findRunningOpByWorkspace("ws-a")).toBeUndefined();
  });

  it("ignores failed ops", () => {
    operations.set("op-1", makeManaged("op-1", "ws-a", "failed"));
    expect(findRunningOpByWorkspace("ws-a")).toBeUndefined();
  });

  it("returns the first running op when multiple match", () => {
    operations.set("op-1", makeManaged("op-1", "ws-a", "running"));
    operations.set("op-2", makeManaged("op-2", "ws-a", "running"));
    const found = findRunningOpByWorkspace("ws-a");
    expect(found).toBeDefined();
    expect(["op-1", "op-2"]).toContain(found!.operation.id);
  });
});

describe("interjectsInFlight", () => {
  beforeEach(() => {
    interjectsInFlight.clear();
  });

  it("is a Set that tracks workspace names", () => {
    expect(interjectsInFlight.has("ws-a")).toBe(false);
    interjectsInFlight.add("ws-a");
    expect(interjectsInFlight.has("ws-a")).toBe(true);
    interjectsInFlight.delete("ws-a");
    expect(interjectsInFlight.has("ws-a")).toBe(false);
  });
});
