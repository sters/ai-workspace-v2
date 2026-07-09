// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from "vitest";

const runClaudeMock = vi.fn();
const getConfigMock = vi.fn();
const ensureMemoryMock = vi.fn();

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

import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { setSession, getSession } from "@/lib/db/slack-sessions";
import { converse } from "@/lib/slack-server/conversation";

interface FakeEvent {
  type: string;
  data?: string;
}

/** A stub ClaudeProcess that replays scripted events when onEvent is attached. */
function fakeProc(opts: { sessionId?: string; resultText?: string; events: FakeEvent[] }) {
  return {
    id: "slack-chat",
    onEvent: (handler: (e: FakeEvent) => void) => {
      for (const e of opts.events) handler(e);
    },
    getSessionId: () => opts.sessionId ?? null,
    getResultText: () => opts.resultText,
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
    getConfigMock.mockReturnValue({
      slack: { memoryEnabled: true, chatModel: "sonnet", chatEffort: "medium" },
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
      slack: { memoryEnabled: false, chatModel: null, chatEffort: null },
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
});
