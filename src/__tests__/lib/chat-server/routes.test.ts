import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChatSessionInfo } from "@/types/chat";
import { CHAT_BUSY_IDLE_MS } from "@/lib/chat-server/constants";

vi.mock("@/lib/db/chat-sessions", () => ({
  upsertChatSession: vi.fn(),
  markChatSessionExited: vi.fn(),
  deleteChatSession: vi.fn(),
}));

interface FakeSessionInit {
  id: string;
  workspaceId: string;
  /** How long ago the PTY last wrote, in ms. */
  quietFor: number;
  exited?: boolean;
}

function seedSessions(...inits: FakeSessionInit[]) {
  const now = Date.now();
  const sessions = new Map<string, unknown>();
  for (const init of inits) {
    sessions.set(init.id, {
      id: init.id,
      workspaceId: init.workspaceId,
      startedAt: now - init.quietFor,
      lastOutputAt: now - init.quietFor,
      exited: init.exited ?? false,
    });
  }
  (globalThis as unknown as { __chatSessions: Map<string, unknown> }).__chatSessions =
    sessions;
}

async function listSessions(): Promise<ChatSessionInfo[]> {
  const { handleSessionsList } = await import("@/lib/chat-server/routes");
  return handleSessionsList().json();
}

describe("handleSessionsList", () => {
  beforeEach(() => {
    (globalThis as unknown as { __chatSessions: Map<string, unknown> }).__chatSessions =
      new Map();
  });

  it("reports a session whose PTY wrote just now as busy", async () => {
    seedSessions({ id: "chat-1", workspaceId: "ws-a", quietFor: 0 });

    const [session] = await listSessions();
    expect(session.workspaceId).toBe("ws-a");
    expect(session.busy).toBe(true);
  });

  it("reports a session quiet past the threshold as not busy", async () => {
    seedSessions({
      id: "chat-1",
      workspaceId: "ws-a",
      quietFor: CHAT_BUSY_IDLE_MS + 1000,
    });

    const [session] = await listSessions();
    expect(session.busy).toBe(false);
  });

  it("omits exited sessions", async () => {
    seedSessions(
      { id: "chat-1", workspaceId: "ws-a", quietFor: 0, exited: true },
      { id: "chat-2", workspaceId: "ws-b", quietFor: 0 },
    );

    const sessions = await listSessions();
    expect(sessions.map((s) => s.workspaceId)).toEqual(["ws-b"]);
  });
});
