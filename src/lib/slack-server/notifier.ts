import type { WebClient } from "@slack/web-api";
import type { OperationEvent } from "@/types/operation";
import { getEvents } from "@/lib/db/events";
import { listReadyNotifications, deleteNotification } from "@/lib/db/slack-notifications";
import { extractPrUrls, type PrUrlInfo } from "@/lib/workspace/pr-url";

/** Default polling interval for the notifier. 30s is a reasonable balance for
 * a kick-off-and-forget UX (latency tolerable, query overhead negligible). */
const DEFAULT_INTERVAL_MS = 30_000;

const NO_PRS_MSG = "Done! No PRs were created. Please check details on WebUI.";

export interface NotifierOptions {
  client: WebClient;
  intervalMs?: number;
}

export interface Notifier {
  /** Stop the polling loop. Idempotent. */
  stop: () => void;
  /** Run one poll cycle now. Exposed for testing and shutdown drain. */
  runOnce: () => Promise<void>;
}

/**
 * Start a polling loop that:
 *   1. queries `slack_pending_notifications` JOIN `operations` for finished rows
 *   2. for `completed`: extracts PR URLs from events and posts to Slack thread
 *   3. for `failed`: silently drops (per product decision, no failure notification)
 *   4. always deletes the row when handled
 *
 * Errors per row are logged but never crash the loop.
 */
export function startNotifier(opts: NotifierOptions): Notifier {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  async function runOnce(): Promise<void> {
    let ready;
    try {
      ready = listReadyNotifications();
    } catch (err) {
      console.error("[slack-server] notifier: failed to query pending notifications:", err);
      return;
    }
    for (const row of ready) {
      try {
        if (row.status === "completed") {
          const events = getEvents(row.operationId);
          const prs = extractPrUrlsFromEvents(events);
          await opts.client.chat.postMessage({
            channel: row.channel,
            thread_ts: row.threadTs,
            text: buildCompletionMessage(prs),
          });
        }
        // status === "failed": silently drop per product decision
      } catch (err) {
        console.error(
          `[slack-server] notifier: failed to process op=${row.operationId}:`,
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        try {
          deleteNotification(row.operationId);
        } catch (err) {
          console.error(
            `[slack-server] notifier: failed to delete pending row for op=${row.operationId}:`,
            err,
          );
        }
      }
    }
  }

  const handle = setInterval(() => {
    void runOnce();
  }, intervalMs);

  let stopped = false;
  return {
    runOnce,
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(handle);
    },
  };
}

/**
 * Scan an operation's events for GitHub PR URLs. Concatenates the raw `data`
 * field of each event (which is JSON-stringified Claude output) and runs the
 * existing `extractPrUrls` regex over it. Returns deduplicated results.
 */
export function extractPrUrlsFromEvents(events: OperationEvent[]): PrUrlInfo[] {
  const blob = events.map((e) => e.data).join("\n");
  return extractPrUrls(blob);
}

/** Build the Slack message text for a completed autonomous run. */
export function buildCompletionMessage(prs: PrUrlInfo[]): string {
  if (prs.length === 0) return NO_PRS_MSG;
  const list = prs.map((p) => `• ${p.url}`).join("\n");
  return `Done! Created PRs:\n${list}`;
}
