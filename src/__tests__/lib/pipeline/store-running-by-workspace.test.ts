// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { operations, findRunningOpByWorkspace } from "@/lib/pipeline/store";
import type { ManagedOperation } from "@/lib/pipeline/types";
import type { Operation } from "@/types/operation";

function makeManaged(
  id: string,
  workspace: string,
  status: Operation["status"],
): ManagedOperation {
  return {
    operation: {
      id,
      type: "execute",
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
});
