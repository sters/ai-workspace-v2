import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClaudeModel } from "@/types/claude";

const mockSpawnClaudeTerminal = vi.fn();
const mockGetConfig = vi.fn();
const mockEnsureSessionSystemPrompt = vi.fn();
const mockCleanupSessionSystemPrompt = vi.fn();

vi.mock("@/lib/claude/cli", () => ({
  spawnClaudeTerminal: (...args: unknown[]) => mockSpawnClaudeTerminal(...args),
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => mockGetConfig(),
  getResolvedWorkspaceRoot: () => "/mock/workspace-root",
}));

vi.mock("@/lib/templates", () => ({
  buildInitPrompt: () => Promise.resolve("init-prompt-body"),
  buildReviewChatPrompt: () => Promise.resolve("review-prompt-body"),
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSessionSystemPrompt: (...args: unknown[]) => mockEnsureSessionSystemPrompt(...args),
  cleanupSessionSystemPrompt: (...args: unknown[]) => mockCleanupSessionSystemPrompt(...args),
}));

vi.mock("@/lib/db/chat-sessions", () => ({
  upsertChatSession: vi.fn(),
  markChatSessionExited: vi.fn(),
  deleteChatSession: vi.fn(),
}));

function setChatModel(model: ClaudeModel | null) {
  mockGetConfig.mockReturnValue({ chat: { model } });
}

let mockPtyResize: ReturnType<typeof vi.fn>;
/** Settles the spawned process's `exited` promise, for tests about the exit path. */
let exitSpawnedProcess!: (code: number) => void;

beforeEach(() => {
  mockSpawnClaudeTerminal.mockReset();
  mockPtyResize = vi.fn();
  // A pending `exited` keeps the session live, as a real one is while the user
  // is typing in it. Resolving it eagerly marked every session exited.
  mockSpawnClaudeTerminal.mockReturnValue({
    terminal: { write: vi.fn(), resize: mockPtyResize },
    kill: vi.fn(),
    exited: new Promise<number>((resolve) => { exitSpawnedProcess = resolve; }),
  });
  mockGetConfig.mockReset();
  mockEnsureSessionSystemPrompt.mockReset();
  mockEnsureSessionSystemPrompt.mockReturnValue("/mock/session-prompt.md");
  mockCleanupSessionSystemPrompt.mockReset();
  setChatModel("sonnet");

  // Reset the chat-server store to avoid leakage between tests via globalThis.
  const g = globalThis as unknown as {
    __chatSessions?: Map<string, unknown>;
    __chatCounter?: number;
  };
  g.__chatSessions = new Map();
  g.__chatCounter = 0;
});

function makeWs() {
  const sent: string[] = [];
  return {
    send: (data: string) => sent.push(data),
    data: { sessionId: null as string | null },
    sent,
  };
}

async function startSession(size?: { cols: number; rows: number }) {
  const { handleStart } = await import("@/lib/chat-server/handlers");
  const ws = makeWs();
  await handleStart(ws, { type: "start", workspaceId: "demo", ...size });
  return ws;
}

describe("handleStart", () => {
  it("uses the model from chat config (sonnet by default)", async () => {
    setChatModel("sonnet");
    await startSession();

    expect(mockSpawnClaudeTerminal).toHaveBeenCalledTimes(1);
    const [opts] = mockSpawnClaudeTerminal.mock.calls[0];
    expect(opts.args).toEqual(
      expect.arrayContaining(["--model", "sonnet"]),
    );

    // Model flag must come before the positional initial prompt.
    const modelIdx = opts.args.indexOf("--model");
    const promptIdx = opts.args.indexOf("init-prompt-body");
    expect(modelIdx).toBeGreaterThanOrEqual(0);
    expect(promptIdx).toBeGreaterThan(modelIdx + 1);
  });

  it("respects the chat.model override from config", async () => {
    setChatModel("opus");
    await startSession();

    const [opts] = mockSpawnClaudeTerminal.mock.calls[0];
    expect(opts.args).toEqual(expect.arrayContaining(["--model", "opus"]));
    expect(opts.args).not.toContain("sonnet");
  });

  it("omits --model when chat.model is null (CLI default)", async () => {
    setChatModel(null);
    await startSession();

    const [opts] = mockSpawnClaudeTerminal.mock.calls[0];
    expect(opts.args).not.toContain("--model");
  });

  it("creates per-session system prompt with workspace context", async () => {
    await startSession();

    expect(mockEnsureSessionSystemPrompt).toHaveBeenCalledTimes(1);
    const [wsPath, agentName, _sessionId, context] = mockEnsureSessionSystemPrompt.mock.calls[0];
    expect(wsPath).toBe("/mock/workspace-root/workspace/demo");
    expect(agentName).toBe("chat");
    expect(context).toEqual({ workspaceId: "demo" });
  });

  it("spawns the PTY at the size the browser terminal reported", async () => {
    await startSession({ cols: 97, rows: 31 });

    const [opts] = mockSpawnClaudeTerminal.mock.calls[0];
    expect(opts.cols).toBe(97);
    expect(opts.rows).toBe(31);
  });

  it("clamps an absurd reported size instead of spawning at it", async () => {
    await startSession({ cols: 0, rows: 99999 });

    const [opts] = mockSpawnClaudeTerminal.mock.calls[0];
    expect(opts.cols).toBeGreaterThanOrEqual(20);
    expect(opts.rows).toBeLessThanOrEqual(300);
  });

  it("falls back to the PTY defaults when the client reports no size", async () => {
    await startSession();

    const [opts] = mockSpawnClaudeTerminal.mock.calls[0];
    expect(opts.cols).toBeUndefined();
    expect(opts.rows).toBeUndefined();
  });
});

describe("handleResize", () => {
  it("resizes the PTY of the active session", async () => {
    const { handleResize } = await import("@/lib/chat-server/handlers");
    const ws = await startSession({ cols: 100, rows: 30 });

    handleResize(ws, { type: "resize", cols: 140, rows: 45 });

    expect(mockPtyResize).toHaveBeenCalledWith(140, 45);
  });

  it("skips a resize to the size the PTY already has", async () => {
    const { handleResize } = await import("@/lib/chat-server/handlers");
    const ws = await startSession({ cols: 100, rows: 30 });

    handleResize(ws, { type: "resize", cols: 100, rows: 30 });

    expect(mockPtyResize).not.toHaveBeenCalled();
  });

  it("does not throw when the connection has no session", async () => {
    const { handleResize } = await import("@/lib/chat-server/handlers");
    const ws = makeWs();

    expect(() => handleResize(ws, { type: "resize", cols: 100, rows: 30 })).not.toThrow();
  });

  it("skips the resize once the process has exited", async () => {
    const { handleResize } = await import("@/lib/chat-server/handlers");
    const ws = await startSession({ cols: 100, rows: 30 });

    exitSpawnedProcess(0);
    await new Promise((r) => setTimeout(r, 0));
    handleResize(ws, { type: "resize", cols: 140, rows: 45 });

    expect(mockPtyResize).not.toHaveBeenCalled();
  });
});

describe("handleResume", () => {
  it("resizes the PTY to the reconnecting browser's size, after the replay", async () => {
    const { handleResume } = await import("@/lib/chat-server/handlers");
    const ws = await startSession({ cols: 100, rows: 30 });
    const target = makeWs();

    let sentWhenResized: string[] = [];
    mockPtyResize.mockImplementation(() => {
      sentWhenResized = [...target.sent];
    });
    handleResume(target, { type: "resume", sessionId: ws.data.sessionId!, cols: 140, rows: 45 });

    expect(mockPtyResize).toHaveBeenCalledWith(140, 45);
    // The repaint SIGWINCH must land after the old-width buffer has been
    // replayed, or Claude's redraw is overwritten by history.
    expect(sentWhenResized.some(m => JSON.parse(m).type === "replay_done")).toBe(true);
  });

  it("does not resize when the reconnecting browser has the same size", async () => {
    const { handleResume } = await import("@/lib/chat-server/handlers");
    const ws = await startSession({ cols: 100, rows: 30 });

    handleResume(makeWs(), { type: "resume", sessionId: ws.data.sessionId!, cols: 100, rows: 30 });

    expect(mockPtyResize).not.toHaveBeenCalled();
  });
});
