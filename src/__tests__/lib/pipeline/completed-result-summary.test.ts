// @vitest-environment node
/**
 * A completed operation still in the in-memory store wins the dedup in
 * `/api/operations`, so its summary is what the card renders — including the
 * result box it shows without being expanded.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { operations } from "@/lib/pipeline/store";
import { markComplete } from "@/lib/pipeline/events";
import { getOperationSummaries } from "@/lib/pipeline/queries";
import type { ManagedOperation } from "@/lib/pipeline/types";
import type { OperationEvent } from "@/types/operation";

function resultEvent(
  content: string,
  extra: { childLabel?: string; phaseIndex?: number } = {},
): OperationEvent {
  return {
    type: "output",
    operationId: "op-1",
    data: JSON.stringify({
      type: "result",
      subtype: "success",
      result: content,
      total_cost_usd: 0.5,
      duration_ms: 2000,
    }),
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

function makeManaged(events: OperationEvent[]): ManagedOperation {
  return {
    operation: {
      id: "op-1",
      type: "create-pr",
      workspace: "ws",
      status: "running",
      startedAt: new Date().toISOString(),
      children: [],
    },
    claudeProcess: null,
    childProcesses: new Map(),
    events,
    listeners: new Set(),
    pendingAsks: new Map(),
    hasPendingAsk: false,
    abortController: new AbortController(),
  };
}

describe("getOperationSummaries after markComplete", () => {
  beforeEach(() => {
    operations.clear();
  });

  it("reports the result of an operation whose events have been cleared", () => {
    const managed = makeManaged([resultEvent("Draft PR created: https://example.test/pr/1")]);
    operations.set("op-1", managed);

    markComplete(managed, true);

    expect(managed.events).toHaveLength(0);
    const summary = getOperationSummaries()[0];
    expect(summary.resultSummary?.content).toBe("Draft PR created: https://example.test/pr/1");
  });

  it("keeps every child's result of the final phase", () => {
    const managed = makeManaged([
      resultEvent("No PR was created.", { childLabel: "repo-a", phaseIndex: 2 }),
      resultEvent("Draft PR created: https://example.test/pr/1", { childLabel: "repo-b", phaseIndex: 2 }),
    ]);
    operations.set("op-1", managed);

    markComplete(managed, true);

    const results = getOperationSummaries()[0].resultSummary?.results;
    expect(results?.map((r) => r.label)).toEqual(["repo-a", "repo-b"]);
  });
});
