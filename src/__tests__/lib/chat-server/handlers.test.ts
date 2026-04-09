import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClaudeModel } from "@/types/claude";

const mockSpawnClaudeTerminal = vi.fn();
const mockGetConfig = vi.fn();

vi.mock("@/lib/claude/cli", () => ({
  spawnClaudeTerminal: (...args: unknown[]) => mockSpawnClaudeTerminal(...args),
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => mockGetConfig(),
  getResolvedWorkspaceRoot: () => "/mock/workspace-root",
}));

vi.mock("@/lib/templates", () => ({
  buildInitPrompt: () => "init-prompt-body",
  buildReviewChatPrompt: () => "review-prompt-body",
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: () => "/mock/system-prompt.md",
}));

vi.mock("@/lib/db/chat-sessions", () => ({
  upsertChatSession: vi.fn(),
  markChatSessionExited: vi.fn(),
  deleteChatSession: vi.fn(),
}));

function setChatModel(model: ClaudeModel | null) {
  mockGetConfig.mockReturnValue({ chat: { model } });
}

beforeEach(() => {
  mockSpawnClaudeTerminal.mockReset();
  mockSpawnClaudeTerminal.mockReturnValue({
    terminal: { write: vi.fn() },
    kill: vi.fn(),
    exited: Promise.resolve(0),
  });
  mockGetConfig.mockReset();
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

async function startSession() {
  const { handleStart } = await import("@/lib/chat-server/handlers");
  const ws = makeWs();
  handleStart(ws, { type: "start", workspaceId: "demo" });
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
});
