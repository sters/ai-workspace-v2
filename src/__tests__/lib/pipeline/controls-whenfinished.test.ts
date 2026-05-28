// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { operations } from "@/lib/pipeline/store";
import { whenOperationFinished } from "@/lib/pipeline/controls";
import type { ManagedOperation } from "@/lib/pipeline/types";
import type { Operation } from "@/types/operation";
import type { OperationEvent } from "@/types/operation";

function makeManaged(id: string, status: Operation["status"]): ManagedOperation {
  return {
    operation: {
      id,
      type: "update-todo",
      workspace: "ws",
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

describe("whenOperationFinished", () => {
  beforeEach(() => {
    operations.clear();
  });

  it("resolves immediately when the operation is not in the store", async () => {
    const start = Date.now();
    await whenOperationFinished("does-not-exist");
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("resolves immediately when the operation is already non-running", async () => {
    operations.set("op-1", makeManaged("op-1", "completed"));
    const start = Date.now();
    await whenOperationFinished("op-1");
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("resolves when a complete event is emitted via listeners", async () => {
    const managed = makeManaged("op-1", "running");
    operations.set("op-1", managed);

    const promise = whenOperationFinished("op-1");

    setTimeout(() => {
      const event: OperationEvent = {
        type: "complete",
        operationId: "op-1",
        data: JSON.stringify({ exitCode: 0 }),
        timestamp: new Date().toISOString(),
      };
      for (const l of managed.listeners) l(event);
    }, 20);

    await promise;
  });

  it("resolves via polling fallback when status flips without firing the listener", async () => {
    const managed = makeManaged("op-1", "running");
    operations.set("op-1", managed);

    const promise = whenOperationFinished("op-1");

    setTimeout(() => {
      managed.operation.status = "completed";
    }, 30);

    const start = Date.now();
    await promise;
    expect(Date.now() - start).toBeLessThan(1500);
  });

  it("resolves when the operation is removed from the store", async () => {
    const managed = makeManaged("op-1", "running");
    operations.set("op-1", managed);

    const promise = whenOperationFinished("op-1");
    setTimeout(() => operations.delete("op-1"), 30);

    await promise;
  });
});
