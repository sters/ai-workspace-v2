/**
 * Whether a Slack thread's conversation is open in a WebUI chat
 * (`chat-server/slack-thread.ts`). The chat drives the thread's CLI session
 * while it lives, so a Slack turn resuming the same session would interleave
 * with it.
 */

import { getConfig } from "@/lib/config";
import type { ChatSessionInfo } from "@/types/chat";

/** False when the chat server cannot be reached: no chat can be holding the session then. */
export async function isThreadOpenInWebUi(threadKey: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`http://localhost:${getConfig().server.chatPort}/sessions`);
    if (!res.ok) return false;
    const sessions = (await res.json()) as ChatSessionInfo[];
    return sessions.some((s) => s.slackThread === threadKey);
  } catch {
    return false;
  }
}
