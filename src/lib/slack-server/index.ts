import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { AppMentionEvent } from "@slack/types";
import { addPendingNotification } from "@/lib/db/slack-notifications";
import { parseCommand, USAGE, type Command } from "./commands";
import { dispatch } from "./dispatcher";
import { startNotifier, type Notifier } from "./notifier";
import { mergeWithThreadLink } from "./thread-link";

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
 * After dispatching `init` (autonomous mode), a pending-notification row is
 * inserted into SQLite so the notifier can post the PR list once the run
 * completes. `init --only` skips this since no PRs are expected.
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

    const parsed = parseCommand(mention.text ?? "");
    if (!parsed.ok) {
      await say({ text: parsed.reply, thread_ts: mention.thread_ts ?? mention.ts });
      return;
    }

    const command = await maybeAttachThreadLink(client, mention, parsed.command);

    if (command.description.trim() === "") {
      await say({
        text: "init requires a description (or post the mention inside a thread so a link can be attached).\n\n" + USAGE,
        thread_ts: mention.thread_ts ?? mention.ts,
      });
      return;
    }

    try {
      const op = await dispatch(opts.apiBaseUrl, command);
      // Track the operation so the notifier can post PR URLs back when it finishes.
      // `--only` runs init alone (no PRs expected), so skip tracking.
      if (!command.only) {
        try {
          addPendingNotification({
            operationId: op.id,
            channel: mention.channel,
            threadTs: mention.thread_ts ?? mention.ts,
          });
        } catch (err) {
          console.warn(
            `[slack-server] could not record pending notification for op=${op.id}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      await say({
        text: "OK! I'll proceed this soon!",
        thread_ts: mention.thread_ts ?? mention.ts,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[slack-server] dispatch failed:", message);
      await say({
        text: `Sorry, failed to start: ${message}`,
        thread_ts: mention.thread_ts ?? mention.ts,
      });
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
