/**
 * What a page hands to the chat page it navigates to: a task to start on, a
 * topic to open a discussion on, a draft to put in the prompt box, or which
 * chat variant to open.
 *
 * It travels in `sessionStorage` rather than in the URL. A task or a draft is
 * free text of any length, which a query string caps; and a URL that starts a
 * session re-starts it on every reload, which is the wrong answer once the
 * session exists. So the handoff stays readable until the chat page reports it
 * delivered — a reload before that still applies it — and is cleared then, so a
 * reload after it resumes the session instead. The TTL covers the case where it
 * is never delivered (the chat server was down), so a later visit to the tab
 * does not start a session nobody asked for just now.
 *
 * Per tab by construction: the navigation that carries it happens in the tab
 * that stashed it.
 */

export interface ChatHandoff {
  /** Start a task chat on this request (quick create). */
  task?: string;
  /** Start a new session whose opening message is this topic (Pull Requests tab). */
  discussion?: string;
  /** Paste into the prompt box of whichever session opens, left unsent. */
  draft?: string;
  /** Open a chat about this review session. */
  reviewTimestamp?: string;
  /** Open a chat about the research report. */
  researchChat?: boolean;
}

export const CHAT_HANDOFF_TTL_MS = 10 * 60 * 1000;

function key(workspaceId: string): string {
  return `aiw-chat-handoff:${workspaceId}`;
}

export function stashChatHandoff(
  workspaceId: string,
  handoff: ChatHandoff,
  now: number = Date.now(),
): void {
  try {
    sessionStorage.setItem(key(workspaceId), JSON.stringify({ handoff, at: now }));
  } catch {
    // Storage unavailable: the chat page then opens as if navigated to directly.
  }
}

export function peekChatHandoff(workspaceId: string, now: number = Date.now()): ChatHandoff | null {
  try {
    const raw = sessionStorage.getItem(key(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { handoff?: ChatHandoff; at?: number };
    if (!parsed.handoff || typeof parsed.at !== "number" || now - parsed.at > CHAT_HANDOFF_TTL_MS) {
      sessionStorage.removeItem(key(workspaceId));
      return null;
    }
    return parsed.handoff;
  } catch {
    return null;
  }
}

export function clearChatHandoff(workspaceId: string): void {
  try {
    sessionStorage.removeItem(key(workspaceId));
  } catch {
    // nothing to clear
  }
}

export function chatPagePath(workspaceId: string): string {
  return `/workspace/${encodeURIComponent(workspaceId)}/chat/interactive`;
}
