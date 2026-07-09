/**
 * Fetch and format a Slack thread so it can be folded into a conversation
 * prompt. Used on the first mention in a thread — see `handleConversation`.
 *
 * Requires a Slack history scope for the channel type in play
 * (`channels:history` / `groups:history` / `im:history` / `mpim:history`).
 * If the API call fails (e.g. the scope is missing), the caller proceeds
 * without thread context rather than erroring the whole conversation.
 */

import type { WebClient } from "@slack/web-api";

/** Minimal shape of a thread message we care about. */
export interface ThreadMessage {
  user?: string;
  text?: string;
  ts?: string;
  bot_id?: string;
}

/**
 * Render thread messages into a plain-text transcript. Pure.
 *
 * Messages with no text are skipped, and the message whose `ts` equals
 * `excludeTs` (typically the triggering mention itself) is dropped so it
 * isn't duplicated alongside the user's message in the prompt.
 */
export function formatThreadMessages(messages: ThreadMessage[], excludeTs?: string): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (excludeTs && m.ts === excludeTs) continue;
    const text = (m.text ?? "").trim();
    if (text === "") continue;
    const who = m.user ? `@${m.user}` : m.bot_id ? "bot" : "unknown";
    lines.push(`${who}: ${text}`);
  }
  return lines.join("\n");
}

/** Loosely-typed slice of `conversations.replies` we depend on. */
interface RepliesResponse {
  messages?: ThreadMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

/** Hard cap on pages to avoid an unbounded loop on a pathological thread. */
const MAX_PAGES = 50;
const PAGE_SIZE = 200;

/**
 * Fetch every message in a thread (following pagination) and return a
 * formatted transcript. Returns "" if the thread is empty or the fetch fails.
 */
export async function fetchThreadTranscript(
  client: Pick<WebClient, "conversations">,
  channel: string,
  threadTs: string,
  excludeTs?: string,
): Promise<string> {
  const all: ThreadMessage[] = [];
  let cursor: string | undefined;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = (await client.conversations.replies({
        channel,
        ts: threadTs,
        limit: PAGE_SIZE,
        cursor,
      })) as RepliesResponse;

      if (res.messages?.length) all.push(...res.messages);

      cursor = res.response_metadata?.next_cursor;
      if (!res.has_more || !cursor) break;
    }
  } catch (err) {
    console.warn(
      `[slack-server] could not fetch thread (channel=${channel} ts=${threadTs}): ${
        err instanceof Error ? err.message : String(err)
      } — proceeding without thread context`,
    );
    return "";
  }

  return formatThreadMessages(all, excludeTs);
}
