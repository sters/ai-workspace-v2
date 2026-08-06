// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from "vitest";

const runClaudeMock = vi.fn();
const getConfigMock = vi.fn();
const ensureMemoryMock = vi.fn();
const summarizeMock = vi.fn();

vi.mock("@/lib/claude", () => ({
  runClaude: (...args: unknown[]) => runClaudeMock(...args),
}));
vi.mock("@/lib/config", () => ({
  getConfig: () => getConfigMock(),
  getResolvedWorkspaceRoot: () => "/ws",
}));
vi.mock("@/lib/workspace/prompts", () => ({
  ensureGlobalSystemPrompt: () => "/ws/prompts/slack-chat.md",
}));
vi.mock("@/lib/slack-server/memory-db", () => ({
  ensureSlackMemoryDb: (...args: unknown[]) => ensureMemoryMock(...args),
}));
vi.mock("@/lib/slack-server/progress-summary", () => ({
  summarizeProgress: (...args: unknown[]) => summarizeMock(...args),
}));

import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { setSession, getSession } from "@/lib/db/slack-sessions";
import { converse } from "@/lib/slack-server/conversation";

interface FakeEvent {
  type: string;
  data?: string;
}

/** A stub ClaudeProcess that replays scripted events when onEvent is attached. */
function fakeProc(opts: {
  sessionId?: string;
  resultText?: string;
  assistantText?: string;
  events: FakeEvent[];
}) {
  return {
    id: "slack-chat",
    onEvent: (handler: (e: FakeEvent) => void) => {
      for (const e of opts.events) handler(e);
    },
    getSessionId: () => opts.sessionId ?? null,
    getResultText: () => opts.resultText,
    getAssistantText: () => opts.assistantText ?? "",
    kill: () => {},
    submitAnswer: () => false,
  };
}

const complete = (exitCode = 0): FakeEvent => ({
  type: "complete",
  data: JSON.stringify({ exitCode }),
});

/** Last prompt string passed to runClaude. */
function lastPrompt(): string {
  return runClaudeMock.mock.calls.at(-1)![1] as string;
}
function callResume(i: number): string | undefined {
  return (runClaudeMock.mock.calls[i][2] as { resumeSessionId?: string }).resumeSessionId;
}

describe("converse", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
    runClaudeMock.mockReset();
    ensureMemoryMock.mockReset();
    ensureMemoryMock.mockReturnValue("/ws/.ai-workspace/slack-memory.sqlite");
    summarizeMock.mockReset();
    summarizeMock.mockResolvedValue("a summary");
    getConfigMock.mockReturnValue({
      slack: {
        memoryEnabled: true,
        chatModel: "sonnet",
        chatEffort: "medium",
        chatHeartbeatMs: 3 * 60 * 1000,
        chatMaxTurnMs: 18 * 60 * 1000,
        chatProgressModel: "haiku",
      },
    });
  });

  it("runs a first turn without resume and persists the session id", async () => {
    runClaudeMock.mockReturnValue(
      fakeProc({ sessionId: "sess-1", resultText: "hello!", events: [complete(0)] }),
    );

    const reply = await converse("thread-1", "hi", { userId: "U1" });

    expect(reply).toBe("hello!");
    expect(callResume(0)).toBeUndefined();
    expect(getSession("thread-1", Date.now())).toBe("sess-1");
  });

  it("folds per-user memory into the first-turn prompt when enabled", async () => {
    runClaudeMock.mockReturnValue(
      fakeProc({ sessionId: "s", resultText: "ok", events: [complete(0)] }),
    );

    await converse("t", "hi", { userId: "U9" });

    expect(ensureMemoryMock).toHaveBeenCalledWith("/ws");
    expect(lastPrompt()).toContain("Your memory about this user");
    expect(lastPrompt()).toContain("U9");
  });

  it("omits memory when memoryEnabled is false", async () => {
    getConfigMock.mockReturnValue({
      slack: {
        memoryEnabled: false,
        chatModel: null,
        chatEffort: null,
        chatHeartbeatMs: 3 * 60 * 1000,
        chatMaxTurnMs: 18 * 60 * 1000,
        chatProgressModel: "haiku",
      },
    });
    runClaudeMock.mockReturnValue(
      fakeProc({ sessionId: "s", resultText: "ok", events: [complete(0)] }),
    );

    await converse("t", "hi", { userId: "U9" });

    expect(ensureMemoryMock).not.toHaveBeenCalled();
    expect(lastPrompt()).not.toContain("Your memory about this user");
  });

  it("omits memory when the user id is unknown", async () => {
    runClaudeMock.mockReturnValue(
      fakeProc({ sessionId: "s", resultText: "ok", events: [complete(0)] }),
    );

    await converse("t", "hi", {});

    expect(ensureMemoryMock).not.toHaveBeenCalled();
    expect(lastPrompt()).not.toContain("Your memory about this user");
  });

  it("points the first turn at this thread's scratch directory", async () => {
    runClaudeMock.mockReturnValue(
      fakeProc({ sessionId: "s", resultText: "ok", events: [complete(0)] }),
    );

    await converse("1712345678.123456", "keep a note", { userId: "U9" });

    expect(lastPrompt()).toContain("/ws/.ai-workspace/slack-scratch/1712345678.123456");
  });

  it("does not repeat the scratch directory on resume turns", async () => {
    setSession("t-resume", "sess", Date.now());
    runClaudeMock.mockReturnValue(
      fakeProc({ sessionId: "sess", resultText: "ok", events: [complete(0)] }),
    );

    await converse("t-resume", "and again", { userId: "U9" });

    expect(lastPrompt()).toBe("and again");
  });

  it("retries fresh when a resumed session fails (stale session id)", async () => {
    setSession("thread-1", "old-sess", Date.now());
    runClaudeMock
      .mockReturnValueOnce(fakeProc({ resultText: undefined, events: [complete(1)] }))
      .mockReturnValueOnce(
        fakeProc({ sessionId: "new-sess", resultText: "recovered", events: [complete(0)] }),
      );

    const reply = await converse("thread-1", "hi", { userId: "U1" });

    expect(reply).toBe("recovered");
    expect(runClaudeMock).toHaveBeenCalledTimes(2);
    expect(callResume(0)).toBe("old-sess"); // first attempt resumed
    expect(callResume(1)).toBeUndefined(); // retry is fresh
    expect(getSession("thread-1", Date.now())).toBe("new-sess");
  });

  it("does not retry a fresh (non-resume) first turn that fails", async () => {
    runClaudeMock.mockReturnValue(fakeProc({ resultText: undefined, events: [complete(1)] }));

    await converse("thread-x", "hi", { userId: "U1" });

    expect(runClaudeMock).toHaveBeenCalledTimes(1);
  });

  it("persists the session id on the hard cap so the thread can resume", async () => {
    vi.useFakeTimers();
    try {
      // No complete event → the turn never settles on its own and hits the cap.
      runClaudeMock.mockReturnValue(
        fakeProc({ sessionId: "sess-timeout", events: [] }),
      );

      const promise = converse("thread-timeout", "a big investigation", { userId: "U1" });
      await vi.advanceTimersByTimeAsync(18 * 60 * 1000);
      const reply = await promise;

      expect(reply).toContain("took too long");
      expect(getSession("thread-timeout", Date.now())).toBe("sess-timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not persist a session on the hard cap when none was captured", async () => {
    vi.useFakeTimers();
    try {
      runClaudeMock.mockReturnValue(fakeProc({ events: [] }));

      const promise = converse("thread-none", "hi", { userId: "U1" });
      await vi.advanceTimersByTimeAsync(18 * 60 * 1000);
      await promise;

      expect(getSession("thread-none", Date.now())).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("summarizes progress on the heartbeat and posts the summary", async () => {
    vi.useFakeTimers();
    try {
      runClaudeMock.mockReturnValue(
        fakeProc({ sessionId: "s", assistantText: "grepping the logs…", events: [] }),
      );
      summarizeMock.mockResolvedValue("Reading the auth logs.");
      const onProgress = vi.fn();

      const promise = converse("thread-hb", "investigate", { userId: "U1", onProgress });
      // One heartbeat interval elapses before the turn completes.
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

      expect(summarizeMock).toHaveBeenCalledWith("grepping the logs…", "haiku");
      expect(onProgress).toHaveBeenCalledWith("Reading the auth logs.");

      // Let it reach the cap so the promise settles.
      await vi.advanceTimersByTimeAsync(18 * 60 * 1000);
      await promise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("posts a bare marker (no summarization) when there is no assistant text yet", async () => {
    vi.useFakeTimers();
    try {
      runClaudeMock.mockReturnValue(fakeProc({ sessionId: "s", assistantText: "", events: [] }));
      const onProgress = vi.fn();

      const promise = converse("thread-empty", "investigate", { userId: "U1", onProgress });
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

      expect(summarizeMock).not.toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith("");

      await vi.advanceTimersByTimeAsync(18 * 60 * 1000);
      await promise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips summarization and posts a bare marker when chatProgressModel is null", async () => {
    vi.useFakeTimers();
    try {
      getConfigMock.mockReturnValue({
        slack: {
          memoryEnabled: true,
          chatModel: "sonnet",
          chatEffort: "medium",
          chatHeartbeatMs: 3 * 60 * 1000,
          chatMaxTurnMs: 18 * 60 * 1000,
          chatProgressModel: null,
        },
      });
      runClaudeMock.mockReturnValue(
        fakeProc({ sessionId: "s", assistantText: "grepping the logs…", events: [] }),
      );
      const onProgress = vi.fn();

      const promise = converse("thread-null", "investigate", { userId: "U1", onProgress });
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

      expect(summarizeMock).not.toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith("");

      await vi.advanceTimersByTimeAsync(18 * 60 * 1000);
      await promise;
    } finally {
      vi.useRealTimers();
    }
  });
});
