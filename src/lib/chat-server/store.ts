import type { ChatSession } from "@/types/chat-server";

const store = globalThis as unknown as {
  __chatSessions?: Map<string, ChatSession>;
  __chatCounter?: number;
  __chatGcTimer?: ReturnType<typeof setInterval>;
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
