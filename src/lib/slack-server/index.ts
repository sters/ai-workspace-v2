import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { AppMentionEvent } from "@slack/types";
import { addPendingNotification } from "@/lib/db/slack-notifications";
import { deleteSession } from "@/lib/db/slack-sessions";
import { bindThreadWorkspace, endThreadTurn, startThreadTurn } from "@/lib/db/slack-thread-workspaces";
import { chatPagePath } from "@/lib/chat-handoff";
import { resolveBoundWorkspace } from "./bound-workspace";
import { parseCommand, USAGE, type Command } from "./commands";
import { converse, hasThreadSession, type BoundWorkspace } from "./conversation";
import { dispatch } from "./dispatcher";
import { startNotifier, type Notifier } from "./notifier";
import { fetchThreadTranscript } from "./thread-fetch";
import { mergeWithThreadLink } from "./thread-link";
import {
  composeStatus,
  createdHeader,
  CREATING_WORKSPACE,
  postStatus,
  updateStatus,
  WORKING,
  workingInHeader,
} from "./status-message";
import { isThreadOpenInWebUi } from "./webui-attach";
import { createSlackWorkspace } from "./workspace-create";

export interface SlackServerOptions {
  botToken: string;
  appToken: string;
  /** Set of Slack user IDs allowed to invoke commands. Empty = nobody. */
  allowedUserIds: Set<string>;
  /** Local API base URL, e.g. `http://localhost:3741`. */
  apiBaseUrl: string;
}

export interface RunningSlackServer {
  app: App;
  /** Stop the Bolt connection and the completion-notification poller. */
  stop: () => Promise<void>;
}

/**
 * Construct and start a Bolt app in Socket Mode plus a polling notifier that
 * delivers PR URLs back to the original mention thread when the autonomous
 * pipeline finishes. Returns both so the caller can shut everything down.
 *
 * The bot only handles `app_mention` events. Mentions from non-allowlisted
 * users are silently dropped (no reply, no reaction).
 *
 * If the mention is inside an existing thread, the thread's permalink (only
 * the URL, not the message bodies) is appended to the description so Claude
 * can decide to fetch the thread on demand.
 *
 * `init` and `ws` each report through one status message, edited in place
 * (`status-message.ts`). For `init` a pending-notification row records it in
 * SQLite, so the notifier can add the workspace once created and the result
 * once the run finishes.
 *
 * `ws` creates a workspace and binds the thread to it. In a bound thread the
 * conversation runs inside the workspace, and `init` works on it instead of
 * creating another one.
 */
export async function startSlackServer(opts: SlackServerOptions): Promise<RunningSlackServer> {
  const app = new App({
    token: opts.botToken,
    appToken: opts.appToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  app.event("app_mention", async ({ event, say, client }) => {
    const mention = event as AppMentionEvent;
    const user = mention.user;

    if (!user || !opts.allowedUserIds.has(user)) {
      console.log(`[slack-server] rejected mention from user=${user ?? "unknown"} channel=${mention.channel}`);
      return;
    }

    const threadTs = mention.thread_ts ?? mention.ts;
    const parsed = parseCommand(mention.text ?? "");
    if (!parsed.ok) {
      if (parsed.kind === "chat") {
        await handleConversation(client, mention, parsed.message, user, await resolveBoundWorkspace(threadTs));
      } else {
        await say({ text: parsed.reply, thread_ts: threadTs });
      }
      return;
    }

    const command = await maybeAttachThreadLink(client, mention, parsed.command);

    if (command.description.trim() === "") {
      await say({
        text: `${command.op} requires a description (or post the mention inside a thread so a link can be attached).\n\n` + USAGE,
        thread_ts: threadTs,
      });
      return;
    }

    if (command.op === "ws") {
      await handleWorkspaceCreate(client, mention, command.description, user, opts.apiBaseUrl);
      return;
    }

    const bound = await resolveBoundWorkspace(threadTs);
    const header = bound ? workingInHeader(bound.name) : undefined;
    const statusTs = await postStatus(
      client,
      mention.channel,
      threadTs,
      header ? composeStatus(header, WORKING) : CREATING_WORKSPACE,
    );
    try {
      const op = await dispatch(opts.apiBaseUrl, command, bound?.name);
      try {
        addPendingNotification({
          operationId: op.id,
          channel: mention.channel,
          threadTs: threadTs,
          messageTs: statusTs,
          statusHeader: header,
        });
      } catch (err) {
        console.warn(
          `[slack-server] could not record pending notification for op=${op.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[slack-server] dispatch failed:", message);
      await updateStatus(client, mention.channel, threadTs, statusTs, composeStatus(header, `Sorry, failed to start: ${message}`));
    }
  });

  await app.start();
  console.log("[slack-server] Socket Mode connection established");

  const notifier: Notifier = startNotifier({ client: app.client });
  console.log("[slack-server] completion notifier started");

  return {
    app,
    stop: async () => {
      notifier.stop();
      await app.stop();
    },
  };
}

/** A status message already in the thread, which the turn edits instead of posting its own placeholder. */
interface ThreadStatus {
  ts?: string;
  /** Kept above the turn's progress and reply. */
  header?: string;
}

/**
 * Handle a free-form conversation mention: post a placeholder in the thread
 * (or take over `status`), run a Claude query (continuing the thread's session
 * if one exists), then edit the placeholder with the reply. On any Slack API
 * failure along the way we fall back to posting a fresh message so the user
 * always gets an answer.
 *
 * The Slack thread (`thread_ts ?? ts`) is the conversation key, so follow-up
 * mentions in the same thread continue the same Claude session. `userId` scopes
 * the conversation's per-user memory.
 *
 * A bound thread's session can also be continued from the WebUI chat, and only
 * one side drives it at a time: the turn is marked in flight for the chat
 * server to see, and refused while a chat holds the session.
 */
async function handleConversation(
  client: WebClient,
  mention: AppMentionEvent,
  message: string,
  userId: string,
  workspace?: BoundWorkspace,
  status?: ThreadStatus,
): Promise<void> {
  const threadTs = mention.thread_ts ?? mention.ts;
  if (!workspace) {
    await runConversationTurn(client, mention, message, userId, undefined, status);
    return;
  }

  // Marked before the check, so a chat starting in between sees the turn.
  startThreadTurn(threadTs, Date.now());
  try {
    if (await isThreadOpenInWebUi(threadTs)) {
      await updateStatus(
        client,
        mention.channel,
        threadTs,
        status?.ts,
        composeStatus(
          status?.header,
          "This conversation is open in the WebUI chat right now. Stop the session there, then mention me again to continue here.",
        ),
      );
      return;
    }
    await runConversationTurn(client, mention, message, userId, workspace, status);
  } finally {
    endThreadTurn(threadTs);
  }
}

async function runConversationTurn(
  client: WebClient,
  mention: AppMentionEvent,
  message: string,
  userId: string,
  workspace?: BoundWorkspace,
  status?: ThreadStatus,
): Promise<void> {
  const threadTs = mention.thread_ts ?? mention.ts;
  const header = status?.header;

  // First mention inside an existing thread: fold the whole thread in as
  // context so the user can ask things like "summarize this thread". On
  // resume turns the CLI session already holds the context, so we skip the
  // fetch. Fetch before posting the placeholder so it isn't included; a
  // status message posted earlier is left out by its ts.
  let threadContext = "";
  if (mention.thread_ts && !hasThreadSession(threadTs)) {
    threadContext = await fetchThreadTranscript(
      client,
      mention.channel,
      mention.thread_ts,
      status?.ts ? [mention.ts, status.ts] : [mention.ts],
    );
  }

  const placeholderTs = status
    ? status.ts
    : await postStatus(client, mention.channel, threadTs, "🤔 Thinking…");

  // While the turn runs, edit the placeholder in place with a snapshot of the
  // assistant's progress so a long investigation reads as a live status line
  // rather than a silent wait. Guarded by `finished` so a late in-flight update
  // can't clobber the final answer.
  let finished = false;
  const onProgress = async (progress: string): Promise<void> => {
    if (finished || !placeholderTs) return;
    try {
      await client.chat.update({
        channel: mention.channel,
        ts: placeholderTs,
        text: composeStatus(header, formatProgress(progress)),
      });
    } catch (err) {
      console.warn(
        "[slack-server] could not update progress:",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  let reply: string;
  try {
    reply = await converse(threadTs, message, {
      userId,
      threadContext: threadContext || undefined,
      onProgress,
      workspace,
    });
  } catch (err) {
    reply = `Sorry, something went wrong: ${err instanceof Error ? err.message : String(err)}`;
  }
  finished = true;

  await updateStatus(client, mention.channel, threadTs, placeholderTs, composeStatus(header, reply));
}

/**
 * Handle `ws`: create a workspace for the request, bind the thread to it, then
 * hand the request to the thread's first conversation turn inside it. One
 * status message carries all of it, from creating through the turn's reply.
 *
 * Any session the thread already had is dropped on binding: it ran at the
 * ai-workspace root under the read-only prompt, and resuming it from the
 * workspace would carry neither the workspace context nor its write policy.
 */
async function handleWorkspaceCreate(
  client: WebClient,
  mention: AppMentionEvent,
  description: string,
  userId: string,
  apiBaseUrl: string,
): Promise<void> {
  const threadTs = mention.thread_ts ?? mention.ts;
  let statusTs = await postStatus(client, mention.channel, threadTs, CREATING_WORKSPACE);
  const created = await createSlackWorkspace(apiBaseUrl, description);
  if (!created.ok) {
    await updateStatus(
      client,
      mention.channel,
      threadTs,
      statusTs,
      created.reason === "no-repositories"
        ? "I couldn't tell which repository this is about. Mention `ws` again with the repository named (e.g. `github.com/org/repo`)."
        : created.reason === "plan-failed"
          ? "Sorry, I couldn't work out the workspace to create. Please try again."
          : `Sorry, failed to create the workspace: ${created.error}`,
    );
    return;
  }

  bindThreadWorkspace(threadTs, created.workspace, await fetchPermalink(client, mention.channel, threadTs));
  deleteSession(threadTs);

  const lines = [
    `${createdHeader(created.workspace, created.repositories)} This thread now works in it; \`init <what to do>\` here plans and runs work on it through to a PR.`,
    `To continue this conversation in the WebUI, open <${apiBaseUrl}${chatPagePath(created.workspace)}|its chat> and choose *Continue Slack conversation*.`,
  ];
  for (const p of created.problems) lines.push(`⚠️ \`${p.repository}\`: ${p.error}`);
  const header = lines.join("\n");
  statusTs = await updateStatus(client, mention.channel, threadTs, statusTs, composeStatus(header, WORKING));

  const bound = await resolveBoundWorkspace(threadTs);
  await handleConversation(
    client,
    mention,
    description,
    userId,
    bound ? { ...bound, newWorkspace: true } : { path: created.workspacePath, newWorkspace: true },
    { ts: statusTs, header },
  );
}

/** Link to a message, or undefined when Slack would not give one: the link is a convenience, never a reason to fail. */
async function fetchPermalink(client: WebClient, channel: string, messageTs: string): Promise<string | undefined> {
  try {
    const res = await client.chat.getPermalink({ channel, message_ts: messageTs });
    return res.permalink || undefined;
  } catch (err) {
    console.warn(
      `[slack-server] could not fetch permalink (channel=${channel} ts=${messageTs}):`,
      err instanceof Error ? err.message : String(err),
    );
    return undefined;
  }
}

/** Safety cap on the summary length (it's already a one-liner from the model). */
const PROGRESS_MAX_CHARS = 300;

/**
 * Render an interim progress line for the Slack status message. `summary` is a
 * one-line status from the progress model; falls back to a bare "still working"
 * marker when it's empty (nothing said yet, summarization disabled, or failed).
 */
function formatProgress(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) return "⏳ Still working…";
  const clipped =
    trimmed.length > PROGRESS_MAX_CHARS
      ? trimmed.slice(0, PROGRESS_MAX_CHARS) + "…"
      : trimmed;
  return `⏳ ${clipped}`;
}

/**
 * If the mention is inside a thread, fetch a permalink for the thread's root
 * message via `chat.getPermalink` and fold it into the command's description.
 * Failures (network, channel not accessible, etc.) are logged but do not
 * abort the operation — the user's typed description is used as-is.
 */
async function maybeAttachThreadLink(
  client: WebClient,
  mention: AppMentionEvent,
  command: Command,
): Promise<Command> {
  if (!mention.thread_ts) return command;

  let permalink: string;
  try {
    const res = await client.chat.getPermalink({
      channel: mention.channel,
      message_ts: mention.thread_ts,
    });
    permalink = res.permalink ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[slack-server] could not fetch permalink (channel=${mention.channel} ts=${mention.thread_ts}): ${msg} — proceeding without thread link`,
    );
    return command;
  }

  if (!permalink) return command;
  return { ...command, description: mergeWithThreadLink(command.description, permalink) };
}
