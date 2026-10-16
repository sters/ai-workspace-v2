/**
 * The Next.js side's calls into the chat server, which is a separate process.
 */

import { getConfig } from "@/lib/config";

export type StartChatResult = { ok: true; sessionId: string } | { ok: false; error: string };

/**
 * Start a task chat no browser is attached to. The chat page resumes it like
 * any live session, replaying what it wrote meanwhile.
 */
export async function startTaskChatSession(
  workspaceId: string,
  task: string,
): Promise<StartChatResult> {
  const chatPort = getConfig().server.chatPort;
  let res: Response;
  try {
    res = await fetch(`http://localhost:${chatPort}/sessions/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, task }),
    });
  } catch (err) {
    return { ok: false, error: `Chat server unreachable: ${err}` };
  }
  const body = (await res.json().catch(() => null)) as { sessionId?: string; error?: string } | null;
  if (res.ok && body?.sessionId) return { ok: true, sessionId: body.sessionId };
  return { ok: false, error: body?.error ?? `Chat server returned HTTP ${res.status}` };
}
