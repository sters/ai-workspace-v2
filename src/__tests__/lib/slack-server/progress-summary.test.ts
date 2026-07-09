// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from "vitest";

const runClaudeMock = vi.fn();

vi.mock("@/lib/claude", () => ({
  runClaude: (...args: unknown[]) => runClaudeMock(...args),
}));
vi.mock("@/lib/config", () => ({
  getResolvedWorkspaceRoot: () => "/ws",
}));

import { summarizeProgress } from "@/lib/slack-server/progress-summary";

interface FakeEvent {
  type: string;
  data?: string;
}

function fakeProc(opts: { resultText?: string; events: FakeEvent[] }) {
  return {
    id: "slack-progress",
    onEvent: (handler: (e: FakeEvent) => void) => {
      for (const e of opts.events) handler(e);
    },
    getResultText: () => opts.resultText,
    getSessionId: () => null,
    getAssistantText: () => "",
    kill: () => {},
    submitAnswer: () => false,
  };
}

const complete = (): FakeEvent => ({ type: "complete", data: JSON.stringify({ exitCode: 0 }) });

describe("summarizeProgress", () => {
  beforeEach(() => {
    runClaudeMock.mockReset();
  });

  it("returns the model's one-line summary", async () => {
    runClaudeMock.mockReturnValue(
      fakeProc({ resultText: "  Reading the auth logs.  ", events: [complete()] }),
    );

    const summary = await summarizeProgress("I am now grepping the logs…", "haiku");

    expect(summary).toBe("Reading the auth logs.");
  });

  it("uses the configured model", async () => {
    runClaudeMock.mockReturnValue(fakeProc({ resultText: "ok", events: [complete()] }));

    await summarizeProgress("work", "sonnet");

    expect(runClaudeMock.mock.calls[0][2]).toMatchObject({ model: "sonnet" });
  });

  it("skips the spawn and returns undefined for empty text", async () => {
    const summary = await summarizeProgress("   ", "haiku");

    expect(summary).toBeUndefined();
    expect(runClaudeMock).not.toHaveBeenCalled();
  });

  it("returns undefined when the summarizer errors", async () => {
    runClaudeMock.mockReturnValue(fakeProc({ events: [{ type: "error" }] }));

    const summary = await summarizeProgress("work", "haiku");

    expect(summary).toBeUndefined();
  });

  it("returns undefined when the summarizer produces no text", async () => {
    runClaudeMock.mockReturnValue(fakeProc({ resultText: "", events: [complete()] }));

    const summary = await summarizeProgress("work", "haiku");

    expect(summary).toBeUndefined();
  });

  it("returns undefined and kills the process on timeout", async () => {
    vi.useFakeTimers();
    try {
      const kill = vi.fn();
      runClaudeMock.mockReturnValue({ ...fakeProc({ events: [] }), kill });

      const promise = summarizeProgress("work", "haiku");
      await vi.advanceTimersByTimeAsync(30_000);
      const summary = await promise;

      expect(summary).toBeUndefined();
      expect(kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
