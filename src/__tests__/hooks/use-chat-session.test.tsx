import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockInit = vi.fn();
const mockDispose = vi.fn();
const term = { cols: 100, rows: 30, write: vi.fn(), onData: vi.fn(() => ({ dispose: vi.fn() })) };

vi.mock("@/hooks/use-terminal", () => ({
  useTerminal: () => ({
    containerRef: { current: null },
    termRef: { current: term },
    init: mockInit,
    dispose: mockDispose,
  }),
}));

import { useChatSession } from "@/hooks/use-chat-session";

/** Every socket the hook opened, newest last. */
let sockets: FakeSocket[] = [];

class FakeSocket {
  static OPEN = 1;
  readyState = FakeSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    sockets.push(this);
    // The real socket connects asynchronously; opening in the constructor
    // would fire before the hook has attached its handlers.
    queueMicrotask(() => this.onopen?.());
  }

  send(data: string) {
    this.sent.push(data);
  }

  /** A frame from the chat server. */
  receive(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  close() {
    this.readyState = 3;
  }

  /** What the hook asked for on the `start`/`resume` frame it sent. */
  firstFrame(): Record<string, unknown> {
    return JSON.parse(this.sent[0]);
  }
}

function startFrames() {
  return sockets.flatMap((s) => s.sent.map((raw) => JSON.parse(raw)));
}

beforeEach(() => {
  sockets = [];
  mockInit.mockReset().mockResolvedValue(undefined);
  mockDispose.mockReset();
  term.onData.mockClear();
  localStorage.clear();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queueMicrotask(() => cb(0));
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useChatSession task", () => {
  it("starts a session on mount and carries the task to the server", async () => {
    renderHook(() => useChatSession("ws", { task: "fix the login crash" }));

    await waitFor(() => expect(sockets).toHaveLength(1));
    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));

    expect(sockets[0].firstFrame()).toMatchObject({
      type: "start",
      workspaceId: "ws",
      task: "fix the login crash",
    });
  });

  it("resumes a saved session instead of starting the work over", async () => {
    localStorage.setItem("aiw-chat:ws", JSON.stringify({ sessionId: "chat-1" }));

    renderHook(() => useChatSession("ws", { task: "fix the login crash" }));

    await waitFor(() => expect(sockets).toHaveLength(1));
    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));

    expect(sockets[0].firstFrame()).toMatchObject({ type: "resume", sessionId: "chat-1" });
    expect(startFrames().some((f) => "task" in f)).toBe(false);
  });

  it("spends the task on a resume, so a reload does not start it after all", async () => {
    localStorage.setItem("aiw-chat:ws", JSON.stringify({ sessionId: "chat-1" }));
    const onHandoffDelivered = vi.fn();
    renderHook(() => useChatSession("ws", { task: "fix the login crash", onHandoffDelivered }));

    await waitFor(() => expect(sockets[0]?.sent).toHaveLength(1));
    sockets[0].receive({ type: "resumed", exited: false });
    expect(onHandoffDelivered).not.toHaveBeenCalled();
    sockets[0].receive({ type: "replay_done" });
    await waitFor(() => expect(onHandoffDelivered).toHaveBeenCalledTimes(1));
  });

  it("stays idle with neither a task nor a saved session", async () => {
    renderHook(() => useChatSession("ws"));

    await new Promise<void>((r) => setTimeout(r, 20));
    expect(sockets).toHaveLength(0);
  });

  it("omits the field entirely when no task was given", async () => {
    localStorage.clear();
    renderHook(() => useChatSession("ws", { initialPrompt: "custom" }));

    await waitFor(() => expect(sockets).toHaveLength(1));
    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));

    expect("task" in sockets[0].firstFrame()).toBe(false);
  });
});

describe("useChatSession discussion", () => {
  it("starts a new session on the topic even when one is saved", async () => {
    // The topic is the opening message, so it needs a session of its own: a
    // resumed one is mid-conversation about something else.
    localStorage.setItem("aiw-chat:ws", JSON.stringify({ sessionId: "chat-1" }));
    const onHandoffDelivered = vi.fn();
    renderHook(() => useChatSession("ws", { discussion: "this comment", onHandoffDelivered }));

    await waitFor(() => expect(sockets[0]?.sent).toHaveLength(1));
    expect(sockets[0].firstFrame()).toMatchObject({ type: "start", discussion: "this comment" });
    expect(startFrames().some((f) => f.type === "resume")).toBe(false);

    sockets[0].receive({ type: "started", sessionId: "chat-2" });
    await waitFor(() => expect(onHandoffDelivered).toHaveBeenCalledTimes(1));
    expect(JSON.parse(localStorage.getItem("aiw-chat:ws") ?? "{}").sessionId).toBe("chat-2");
  });
});

describe("useChatSession handoff delivery", () => {
  it("reports a task delivered once its session has started", async () => {
    const onHandoffDelivered = vi.fn();
    renderHook(() => useChatSession("ws", { task: "fix it", onHandoffDelivered }));

    await waitFor(() => expect(sockets[0]?.sent).toHaveLength(1));
    expect(onHandoffDelivered).not.toHaveBeenCalled();

    sockets[0].receive({ type: "started", sessionId: "chat-1" });
    await waitFor(() => expect(onHandoffDelivered).toHaveBeenCalledTimes(1));
  });
});

describe("useChatSession replacing a session", () => {
  it("names the saved session a discussion displaces, so the server can end it", async () => {
    localStorage.setItem("aiw-chat:ws", JSON.stringify({ sessionId: "chat-1" }));
    renderHook(() => useChatSession("ws", { discussion: "this comment" }));

    await waitFor(() => expect(sockets[0]?.sent).toHaveLength(1));
    expect(sockets[0].firstFrame()).toMatchObject({ type: "start", replaces: "chat-1" });
  });

  it("names the session this hook held once localStorage has forgotten it", async () => {
    // A dropped socket clears localStorage; the session it held is no longer
    // live, so New Session starts one and the server drops the old record.
    const { result } = renderHook(() => useChatSession("ws", { task: "fix it" }));
    await waitFor(() => expect(sockets[0]?.sent).toHaveLength(1));
    act(() => sockets[0].receive({ type: "started", sessionId: "chat-1" }));
    act(() => sockets[0].onerror?.());
    expect(localStorage.getItem("aiw-chat:ws")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));

    await act(() => result.current.openSession());
    await waitFor(() => expect(sockets[1]?.sent).toHaveLength(1));
    expect(sockets[1].firstFrame()).toMatchObject({ type: "start", replaces: "chat-1" });
  });

  it("names nothing when there is no session to displace", async () => {
    renderHook(() => useChatSession("ws", { task: "fix it" }));

    await waitFor(() => expect(sockets[0]?.sent).toHaveLength(1));
    expect("replaces" in sockets[0].firstFrame()).toBe(false);
  });
});

describe("useChatSession openSession", () => {
  function stubLiveSessions(sessions: { id: string; workspaceId: string; startedAt: number }[]) {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => sessions }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("attaches to the workspace's live session instead of starting another", async () => {
    stubLiveSessions([
      { id: "chat-1", workspaceId: "ws", startedAt: 1 },
      { id: "chat-2", workspaceId: "ws", startedAt: 2 },
      { id: "chat-3", workspaceId: "other", startedAt: 3 },
    ]);
    const { result } = renderHook(() => useChatSession("ws"));

    await act(() => result.current.openSession());
    await waitFor(() => expect(sockets[0]?.sent).toHaveLength(1));

    expect(sockets[0].firstFrame()).toMatchObject({ type: "resume", sessionId: "chat-2" });
    expect(startFrames().some((f) => f.type === "start")).toBe(false);
  });

  it("starts a session when the workspace has none live", async () => {
    stubLiveSessions([{ id: "chat-3", workspaceId: "other", startedAt: 3 }]);
    const { result } = renderHook(() => useChatSession("ws"));

    await act(() => result.current.openSession());
    await waitFor(() => expect(sockets[0]?.sent).toHaveLength(1));

    expect(sockets[0].firstFrame()).toMatchObject({ type: "start", workspaceId: "ws" });
  });

  it("starts a session when the live list cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const { result } = renderHook(() => useChatSession("ws"));

    await act(() => result.current.openSession());
    await waitFor(() => expect(sockets[0]?.sent).toHaveLength(1));

    expect(sockets[0].firstFrame()).toMatchObject({ type: "start" });
  });

  it("opens once however many times it is called while opening", async () => {
    const fetchMock = stubLiveSessions([]);
    const { result } = renderHook(() => useChatSession("ws"));

    await act(() =>
      Promise.all([result.current.openSession(), result.current.openSession(), result.current.openSession()]),
    );
    await waitFor(() => expect(sockets[0]?.sent).toHaveLength(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
  });
});
