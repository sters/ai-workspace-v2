import type { WebClient } from "@slack/web-api";
import type { OperationEvent } from "@/types/operation";
import { getEvents } from "@/lib/db/events";
import { getOperation } from "@/lib/db/operations";
import { listReadyNotifications, deleteNotification } from "@/lib/db/slack-notifications";
import { extractPrUrls, type PrUrlInfo } from "@/lib/workspace/pr-url";

/** Phase label set by the autonomous pipeline for the Create PR step
 * (`src/lib/pipelines/autonomous.ts`, `buildCreatePrPhase`). Filtering by
 * this label keeps PR URLs Claude only *read* (in READMEs, comments, gh
 * arguments, etc.) out of the completion notification. */
const CREATE_PR_PHASE_LABEL = "Create PR";

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
          const op = getOperation(row.operationId);
          const inputDescription = op?.inputs?.description;
          const prs = extractCreatedPrs(events, { inputDescription });
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
 * Extract PR URLs that were *actually created* during the autonomous run.
 *
 * Filters event stream to only those whose `phaseLabel === "Create PR"`
 * (the autonomous pipeline's PR-creation phase). This keeps URLs Claude
 * merely read (existing PRs in READMEs, `gh pr view <url>` arguments,
 * issue comments, etc.) out of the notification.
 *
 * If `inputDescription` is provided, any URL that already appeared in the
 * description (e.g. the user pasted "review https://github.com/.../pull/N")
 * is also excluded — Claude is likely to echo it back during the Create PR
 * phase even though it's not the freshly created PR.
 */
export function extractCreatedPrs(
  events: OperationEvent[],
  opts: { inputDescription?: string } = {},
): PrUrlInfo[] {
  const phaseEvents = events.filter((e) => e.phaseLabel === CREATE_PR_PHASE_LABEL);
  const candidates = extractPrUrls(phaseEvents.map((e) => e.data).join("\n"));
  if (!opts.inputDescription) return candidates;

  const inputUrls = new Set(extractPrUrls(opts.inputDescription).map((p) => p.url));
  return candidates.filter((p) => !inputUrls.has(p.url));
}

/** Build the Slack message text for a completed autonomous run. */
export function buildCompletionMessage(prs: PrUrlInfo[]): string {
  if (prs.length === 0) return NO_PRS_MSG;
  const list = prs.map((p) => `• ${p.url}`).join("\n");
  return `Done! Created PRs:\n${list}`;
}
