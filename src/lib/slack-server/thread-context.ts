/**
 * Thread context formatting helpers. Pure functions: take Slack message
 * objects (or anything matching the minimal shape) and return a string
 * suitable for appending to an `init` description so Claude sees the prior
 * Slack discussion as background.
 */

export interface ThreadMessage {
  user?: string;
  text?: string;
  ts: string;
  /** Set when the message was posted by a bot/app integration. */
  bot_id?: string;
  /** Custom display name set on the message (e.g., legacy webhook posts). */
  username?: string;
  /** Bot/app metadata; `name` is the app display name (e.g., "GitHub"). */
  bot_profile?: { name?: string };
}

export interface FormatOptions {
  /** Slack `ts` of the mention message itself; this message is excluded. */
  excludeTs: string;
  /** Our own bot's user_id (from auth.test()). Messages where `user`
   * matches this are dropped so the bot's prior replies don't loop back. */
  ourBotUserId?: string;
  /** Our own bot's bot_id (from auth.test()). Messages where `bot_id`
   * matches this are dropped (covers the case where `user` is absent). */
  ourBotId?: string;
}

const SEPARATOR = "--- Slack thread context ---";

/**
 * Formats messages as `<@USERID>: text` (or `<DisplayName>: text` for app
 * messages) lines, one per message. Drops:
 * - the message identified by `excludeTs` (the mention itself)
 * - the bot's own prior replies (matched by `ourBotUserId` / `ourBotId`)
 * - messages without text content
 *
 * Other bot/app messages (e.g. GitHub, CI, alerts) are included so prior
 * tooling output in the thread becomes part of the context.
 */
export function formatThreadContext(
  messages: ThreadMessage[],
  opts: FormatOptions,
): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.ts === opts.excludeTs) continue;
    if (opts.ourBotUserId && m.user === opts.ourBotUserId) continue;
    if (opts.ourBotId && m.bot_id === opts.ourBotId) continue;
    const text = m.text?.trim();
    if (!text) continue;
    const label = displayNameFor(m);
    lines.push(label ? `${label}: ${text}` : text);
  }
  return lines.join("\n");
}

function displayNameFor(m: ThreadMessage): string | null {
  if (m.user) return `<@${m.user}>`;
  if (m.bot_profile?.name) return m.bot_profile.name;
  if (m.username) return m.username;
  return null;
}

/**
 * Combine an explicit description (from the mention text) with thread context.
 * Used by the handler so callers can pass any combination of empty / non-empty
 * and get a sensible result.
 */
export function mergeIntoDescription(description: string, threadContext: string): string {
  const d = description.trim();
  const t = threadContext.trim();
  if (!d && !t) return "";
  if (!d) return t;
  if (!t) return d;
  return `${d}\n\n${SEPARATOR}\n${t}`;
}
