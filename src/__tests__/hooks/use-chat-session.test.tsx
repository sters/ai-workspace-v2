import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockInit = vi.fn();
const mockDispose = vi.fn();
const term = { cols: 100, rows: 30, write: vi.fn(), paste: vi.fn(), focus: vi.fn(), onData: vi.fn(() => ({ dispose: vi.fn() })) };

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
  term.paste.mockClear();
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

/** Claude's TUI brackets every turn with these (see `readTurnProgress`). */
const TURN_STARTED = "\x1b]9;4;3;\x07";
const TURN_ENDED = "\x1b]9;4;0;\x07";

describe("useChatSession draft", () => {
  it("starts a plain session and pastes the draft once its opening turn is over", async () => {
    const onHandoffDelivered = vi.fn();
    renderHook(() => useChatSession("ws", { draft: "about this diff", onHandoffDelivered }));

    await waitFor(() => expect(sockets[0]?.sent).toHaveLength(1));
    const frame = sockets[0].firstFrame();
    expect(frame.type).toBe("start");
    // The draft is for the prompt box, not the opening message.
    expect(JSON.stringify(frame)).not.toContain("about this diff");

    sockets[0].receive({ type: "started", sessionId: "chat-1" });
    sockets[0].receive({ type: "output", data: `${TURN_STARTED}reading README` });
    await new Promise<void>((r) => setTimeout(r, 700));
    // Pasting into a turn still in flight would land in whatever it is showing.
    expect(term.paste).not.toHaveBeenCalled();
    expect(onHandoffDelivered).not.toHaveBeenCalled();

    sockets[0].receive({ type: "output", data: `Ready.${TURN_ENDED}` });
    await waitFor(() => expect(term.paste).toHaveBeenCalledWith("about this diff"));
    expect(onHandoffDelivered).toHaveBeenCalledTimes(1);
  });

  it("pastes into a resumed session rather than replacing it", async () => {
    localStorage.setItem("aiw-chat:ws", JSON.stringify({ sessionId: "chat-1" }));
    const onHandoffDelivered = vi.fn();
    renderHook(() => useChatSession("ws", { draft: "about this diff", onHandoffDelivered }));

    await waitFor(() => expect(sockets[0]?.sent).toHaveLength(1));
    expect(sockets[0].firstFrame()).toMatchObject({ type: "resume", sessionId: "chat-1" });

    sockets[0].receive({ type: "resumed", exited: false });
    sockets[0].receive({ type: "output", data: `${TURN_STARTED}old turn${TURN_ENDED}` });
    sockets[0].receive({ type: "replay_done" });

    await waitFor(() => expect(term.paste).toHaveBeenCalledWith("about this diff"));
    expect(startFrames().some((f) => f.type === "start")).toBe(false);
    expect(onHandoffDelivered).toHaveBeenCalledTimes(1);
  });

  it("reports a task delivered once its session has started", async () => {
    const onHandoffDelivered = vi.fn();
    renderHook(() => useChatSession("ws", { task: "fix it", onHandoffDelivered }));

    await waitFor(() => expect(sockets[0]?.sent).toHaveLength(1));
    expect(onHandoffDelivered).not.toHaveBeenCalled();

    sockets[0].receive({ type: "started", sessionId: "chat-1" });
    await waitFor(() => expect(onHandoffDelivered).toHaveBeenCalledTimes(1));
  });
});
