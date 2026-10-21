import type { WebClient } from "@slack/web-api";

/**
 * `ws` and `init` each report through one status message in the thread,
 * edited in place: {@link CREATING_WORKSPACE}, then the workspace header over
 * {@link WORKING}, then the header over {@link DONE} or {@link FAILED}. A
 * thread bound to a workspace starts from the header, since nothing is
 * created. The result itself is posted as a new message: the work usually
 * takes long, and an edit notifies nobody.
 */

type ChatClient = Pick<WebClient, "chat">;

export const CREATING_WORKSPACE = "🛠 Creating a workspace…";
export const WORKING = "⏳ Working…";
export const DONE = "✅ Done.";
export const FAILED = "❌ Failed.";

export function createdHeader(workspace: string, repositories: string[] = []): string {
  const repos = repositories.length > 0 ? ` with ${repositories.map((r) => `\`${r}\``).join(", ")}` : "";
  return `Created \`${workspace}\`${repos}.`;
}

export function workingInHeader(workspace: string): string {
  return `Working in \`${workspace}\`.`;
}

export function composeStatus(header: string | undefined, body: string): string {
  return header ? `${header}\n\n${body}` : body;
}

/** Post the status message. Returns its ts, or undefined when Slack refused it. */
export async function postStatus(
  client: ChatClient,
  channel: string,
  threadTs: string,
  text: string,
): Promise<string | undefined> {
  try {
    const res = await client.chat.postMessage({ channel, thread_ts: threadTs, text });
    return res.ts;
  } catch (err) {
    console.warn("[slack-server] could not post status message:", err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

/**
 * Edit the status message, or post `text` as a fresh message when there is
 * none or it cannot be edited. Returns the ts of the message now carrying the
 * status, for the next update to edit.
 */
export async function updateStatus(
  client: ChatClient,
  channel: string,
  threadTs: string,
  messageTs: string | undefined,
  text: string,
): Promise<string | undefined> {
  if (messageTs) {
    try {
      await client.chat.update({ channel, ts: messageTs, text });
      return messageTs;
    } catch (err) {
      console.warn(
        "[slack-server] could not update status message, posting fresh message:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return postStatus(client, channel, threadTs, text);
}

/**
 * Close the status message with `statusLine` under `header`, then post
 * `result` as a new message. When the status message cannot be edited only
 * the result is posted, so it never arrives twice.
 */
export async function finishStatus(
  client: ChatClient,
  channel: string,
  threadTs: string,
  messageTs: string | undefined,
  header: string | undefined,
  statusLine: string,
  result: string,
): Promise<void> {
  if (messageTs) {
    try {
      await client.chat.update({ channel, ts: messageTs, text: composeStatus(header, statusLine) });
    } catch (err) {
      console.warn("[slack-server] could not close status message:", err instanceof Error ? err.message : String(err));
    }
  }
  await client.chat.postMessage({ channel, thread_ts: threadTs, text: result });
}
