// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { operations, findRunningOpsByWorkspace } from "@/lib/pipeline/store";
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

describe("findRunningOpsByWorkspace", () => {
  beforeEach(() => {
    operations.clear();
  });

  it("returns nothing when no op exists for workspace", () => {
    expect(findRunningOpsByWorkspace("missing")).toEqual([]);
  });

  it("returns every running op for the workspace", () => {
    operations.set("op-1", makeManaged("op-1", "ws-a", "running"));
    operations.set("op-2", makeManaged("op-2", "ws-a", "running"));
    operations.set("op-3", makeManaged("op-3", "ws-b", "running"));
    expect(findRunningOpsByWorkspace("ws-a").map((m) => m.operation.id)).toEqual(["op-1", "op-2"]);
  });

  it("ignores completed ops", () => {
    operations.set("op-1", makeManaged("op-1", "ws-a", "completed"));
    expect(findRunningOpsByWorkspace("ws-a")).toEqual([]);
  });
});
