import { GC_MAX_AGE_MS, GC_MAX_EXITED } from "./constants";
import type { ChatSession } from "@/types/chat-server";
import { getStore } from "./store";

export function gcSessions(sessions: Map<string, ChatSession>, now: number): number {
  let removed = 0;

  // Remove sessions that exited more than GC_MAX_AGE_MS ago
  for (const [id, session] of sessions) {
    if (session.exited && session.exitedAt != null && now - session.exitedAt > GC_MAX_AGE_MS) {
      sessions.delete(id);
      removed++;
    }
  }

  // If still too many exited sessions, remove oldest first
  const exitedSessions: Array<{ id: string; exitedAt: number }> = [];
  for (const [id, session] of sessions) {
    if (session.exited && session.exitedAt != null) {
      exitedSessions.push({ id, exitedAt: session.exitedAt });
    }
  }

  if (exitedSessions.length > GC_MAX_EXITED) {
    exitedSessions.sort((a, b) => a.exitedAt - b.exitedAt);
    const toRemove = exitedSessions.length - GC_MAX_EXITED;
    for (let i = 0; i < toRemove; i++) {
      sessions.delete(exitedSessions[i].id);
      removed++;
    }
  }

  return removed;
}

export function runGc() {
  const store = getStore();
  const removed = gcSessions(store.__chatSessions!, Date.now());
  if (removed > 0) {
    console.log(`[chat-server] GC removed ${removed} expired session(s)`);
  }
}
