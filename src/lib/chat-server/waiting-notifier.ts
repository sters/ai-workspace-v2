import { sendChatWaitingNotification } from "@/lib/web-push";
import { takeSessionsTurnedWaiting } from "./activity";
import { getStore } from "./store";

/**
 * Push a notification for every session that has just stopped working.
 *
 * The detection has to live in this process: it owns the PTY, and the browser
 * poll that renders the same transition stops entirely while its tab is hidden
 * (SWR's `refreshWhenHidden: false`) — which is exactly when a notification is
 * the point.
 */
export function notifyWaitingSessions(now = Date.now()): void {
  const turned = takeSessionsTurnedWaiting(getStore().__chatSessions!.values(), now);
  for (const session of turned) {
    console.log(`[chat-server] Session ${session.id} is waiting for input`);
    try {
      sendChatWaitingNotification(session.id, session.workspaceId);
    } catch (err) {
      // A push that cannot be built or signed must not take the chat server
      // down with it — the session itself is unaffected.
      console.error(`[chat-server] failed to notify for ${session.id}: ${err}`);
    }
  }
}
