/**
 * Thread context formatting helpers. Pure functions: take Slack message
 * objects (or anything matching the minimal shape) and return a string
 * suitable for appending to an `init` description so Claude sees the prior
 * Slack discussion as background.
 */

export interface SlackAttachmentField {
  title?: string;
  value?: string;
}

/**
 * Subset of Slack's attachment shape we read. Slack uses attachments for
 * link unfurls (external links, Slack message links, integration posts).
 * We pull text-only fields and ignore image/media URLs by design.
 */
export interface SlackAttachment {
  title?: string;
  title_link?: string;
  text?: string;
  pretext?: string;
  fallback?: string;
  author_name?: string;
  service_name?: string;
  from_url?: string;
  fields?: SlackAttachmentField[];
}

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
  /** Link-unfurl previews and integration-posted cards. */
  attachments?: SlackAttachment[];
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
const UNFURL_PREFIX = "  > ";

/**
 * Formats messages as `<@USERID>: text` (or `<DisplayName>: text` for app
 * messages) lines, one per message. Drops:
 * - the message identified by `excludeTs` (the mention itself)
 * - the bot's own prior replies (matched by `ourBotUserId` / `ourBotId`)
 * - messages with neither text nor extractable attachment content
 *
 * Other bot/app messages (e.g. GitHub, CI, alerts) are included so prior
 * tooling output in the thread becomes part of the context. Link unfurls
 * are extracted from `attachments` and rendered as indented `> ` lines
 * beneath the message that triggered them.
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

    const text = m.text?.trim() ?? "";
    const attachmentLines = (m.attachments ?? []).flatMap(extractAttachmentLines);
    if (!text && attachmentLines.length === 0) continue;

    const label = displayNameFor(m);
    if (text) {
      lines.push(label ? `${label}: ${text}` : text);
    } else if (label) {
      lines.push(`${label}:`);
    }
    for (const al of attachmentLines) {
      lines.push(`${UNFURL_PREFIX}${al}`);
    }
  }
  return lines.join("\n");
}

/**
 * Pull text-only content out of an attachment. Returns one string per
 * logical line (header, body, each field). Images/thumbnails are ignored.
 * `fallback` is used only when no other text fields are present, since
 * Slack typically populates it as a denormalized copy of title+text.
 */
function extractAttachmentLines(att: SlackAttachment): string[] {
  const lines: string[] = [];

  const service = att.service_name?.trim();
  const author = att.author_name?.trim();
  const title = att.title?.trim();
  const titleLink = att.title_link?.trim();

  const headerParts: string[] = [];
  if (service) headerParts.push(`[${service}]`);
  if (author) headerParts.push(author);
  if (title) {
    headerParts.push(titleLink ? `${title} (${titleLink})` : title);
  } else if (titleLink) {
    headerParts.push(titleLink);
  }
  if (headerParts.length) lines.push(headerParts.join(" "));

  const fromUrl = att.from_url?.trim();
  if (fromUrl && fromUrl !== titleLink) {
    lines.push(fromUrl);
  }

  const pretext = att.pretext?.trim();
  if (pretext) lines.push(pretext);

  const text = att.text?.trim();
  if (text) lines.push(text);

  for (const f of att.fields ?? []) {
    const ft = f.title?.trim();
    const fv = f.value?.trim();
    if (ft && fv) lines.push(`${ft}: ${fv}`);
    else if (fv) lines.push(fv);
    else if (ft) lines.push(ft);
  }

  if (lines.length === 0) {
    const fallback = att.fallback?.trim();
    if (fallback) lines.push(fallback);
  }

  return lines;
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
