// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ClaudeProcess } from "@/types/claude";
import type { OperationEvent } from "@/types/operation";
import type { ManagedOperation } from "@/lib/pipeline/types";
import { wireChild } from "@/lib/pipeline/wire-child";
import { emitEvent } from "@/lib/pipeline/events";

vi.mock("@/lib/db", () => ({
  bufferEvent: vi.fn(),
  stopAutoFlush: vi.fn(),
}));

vi.mock("@/lib/web-push", () => ({
  sendAskNotification: vi.fn(),
  sendCompletionNotification: vi.fn(),
}));

function makeManaged(): ManagedOperation {
  return {
    operation: {
      id: "op-1",
      type: "autonomous",
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
}

function makeMockProcess(): {
  process: ClaudeProcess;
  fire: (event: OperationEvent) => void;
} {
  let handler: (event: OperationEvent) => void = () => {};
  const process = {
    onEvent: (fn: (event: OperationEvent) => void) => {
      handler = fn;
    },
    kill: vi.fn(),
    submitAnswer: vi.fn(() => false),
    getResultText: () => "done",
  } as unknown as ClaudeProcess;
  return {
    process,
    fire: (event) => handler(event),
  };
}

const askEvent = (toolId: string): OperationEvent => ({
  type: "output",
  operationId: "op-1",
  data: JSON.stringify({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: toolId,
          name: "AskUserQuestion",
          input: { questions: [{ question: "Empty diff intended?", options: [] }] },
        },
      ],
    },
  }),
  timestamp: new Date().toISOString(),
});

const toolResultEvent = (toolId: string, content: string): OperationEvent => ({
  type: "output",
  operationId: "op-1",
  data: JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: toolId, content, is_error: true }],
    },
  }),
  timestamp: new Date().toISOString(),
});

const completeEvent = (exitCode: number): OperationEvent => ({
  type: "complete",
  operationId: "op-1",
  data: JSON.stringify({ exitCode }),
  timestamp: new Date().toISOString(),
});

describe("wireChild — hasPendingAsk lifecycle", () => {
  it("clears hasPendingAsk when a skipAskUserQuestion child auto-answered its ask then finished", async () => {
    const managed = makeManaged();
    managed.operation.children = [{ id: "c1", label: "review-foo", status: "running" }];
    const { process, fire } = makeMockProcess();

    const done = wireChild(managed, "c1", "review-foo", process);

    // The CLI emitted an AskUserQuestion (skipAskUserQuestion mode), which set
    // the pending flag, then auto-errored it and the process completed.
    fire(askEvent("toolu_ask"));
    expect(managed.hasPendingAsk).toBe(true);
    fire(toolResultEvent("toolu_ask", "Answer questions?"));
    fire(completeEvent(0));

    await done;

    expect(managed.hasPendingAsk).toBe(false);
  });

  it("keeps hasPendingAsk when another still-running child has a genuine unanswered ask", async () => {
    const managed = makeManaged();
    managed.operation.children = [{ id: "c1", label: "review-foo", status: "running" }];

    // A genuine, unanswered ask from a different child that is still running.
    emitEvent(managed, { ...askEvent("toolu_live"), childLabel: "review-bar" });
    expect(managed.hasPendingAsk).toBe(true);

    const { process, fire } = makeMockProcess();
    const done = wireChild(managed, "c1", "review-foo", process);
    fire(askEvent("toolu_ask"));
    fire(toolResultEvent("toolu_ask", "Answer questions?"));
    fire(completeEvent(0));

    await done;

    // review-bar's ask is still pending, so the flag must remain set.
    expect(managed.hasPendingAsk).toBe(true);
  });
});
