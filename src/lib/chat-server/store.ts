import type { ChatSession } from "@/types/chat-server";
import {
  upsertChatSession,
  markChatSessionExited,
  deleteChatSession,
} from "@/lib/db/chat-sessions";

const store = globalThis as unknown as {
  __chatSessions?: Map<string, ChatSession>;
  __chatCounter?: number;
  __chatGcTimer?: ReturnType<typeof setInterval>;
  __chatWaitingTimer?: ReturnType<typeof setInterval>;
};

if (!store.__chatSessions) {
  store.__chatSessions = new Map();
}
if (store.__chatCounter == null) {
  store.__chatCounter = 0;
}

export function getStore() {
  return store;
}

export function nextSessionId(): string {
  return `chat-${++store.__chatCounter!}-${Date.now()}`;
}

export function persistSessionCreated(session: ChatSession): void {
  upsertChatSession({
    id: session.id,
    workspaceId: session.workspaceId,
    startedAt: session.startedAt,
  });
}

export function persistSessionExited(
  id: string,
  exitCode: number | null,
): void {
  markChatSessionExited(id, exitCode);
}

export function persistSessionDeleted(id: string): void {
  deleteChatSession(id);
}
