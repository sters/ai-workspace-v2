import type { WebClient } from "@slack/web-api";
import type { OperationEvent } from "@/types/operation";
import { getEvents } from "@/lib/db/events";
import { getOperation } from "@/lib/db/operations";
import { listReadyNotifications, deleteNotification } from "@/lib/db/slack-notifications";
import { extractPrUrls, type PrUrlInfo } from "@/lib/workspace/pr-url";
import { README_CLARITY_PHASE_LABEL, README_CLARITY_STOP_PREFIX } from "@/lib/templates/prompts/readme-clarity-gate";

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
          // A README-clarity-gate stop means the run halted before doing any
          // work — relay that reason instead of the misleading "no PRs" message.
          const clarityStop = extractClarityGateStop(events);
          const prs = extractCreatedPrs(events, { inputDescription });
          await opts.client.chat.postMessage({
            channel: row.channel,
            thread_ts: row.threadTs,
            text: clarityStop ?? buildCompletionMessage(prs),
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

/** `gh pr create` outputs only the newly created PR URL on stdout, so we treat
 * the tool_result of a Bash call matching this pattern as the authoritative
 * source of created-PR URLs. Anything else (URLs in PR bodies, related-PR
 * references, etc.) is ignored. */
const GH_PR_CREATE_RE = /^\s*gh\s+pr\s+create\b/;

/**
 * Extract PR URLs that were *actually created* during the autonomous run.
 *
 * Strategy: walk the "Create PR" phase events, find Bash `tool_use` blocks
 * whose command is `gh pr create ...`, then pair them with their matching
 * `tool_result` blocks (by `tool_use_id`) and extract PR URLs only from those
 * successful results. This avoids false positives from URLs that appear in
 * the PR body itself (e.g. a template referencing an example PR).
 *
 * If `inputDescription` is provided, any URL that already appeared in the
 * description (e.g. the user pasted "review https://github.com/.../pull/N")
 * is also excluded as a safety net.
 */
export function extractCreatedPrs(
  events: OperationEvent[],
  opts: { inputDescription?: string } = {},
): PrUrlInfo[] {
  const phaseEvents = events.filter((e) => e.phaseLabel === CREATE_PR_PHASE_LABEL);
  const ghPrCreateIds = new Set<string>();
  const resultTexts: string[] = [];

  for (const e of phaseEvents) {
    const blocks = getContentBlocks(e.data);
    for (const block of blocks) {
      if (block.type === "tool_use" && block.name === "Bash") {
        const command = typeof block.input?.command === "string" ? block.input.command : "";
        if (GH_PR_CREATE_RE.test(command) && typeof block.id === "string") {
          ghPrCreateIds.add(block.id);
        }
      } else if (block.type === "tool_result") {
        const id = typeof block.tool_use_id === "string" ? block.tool_use_id : null;
        if (id && ghPrCreateIds.has(id) && block.is_error !== true) {
          resultTexts.push(toolResultText(block.content));
        }
      }
    }
  }

  const candidates = extractPrUrls(resultTexts.join("\n"));
  if (!opts.inputDescription) return candidates;

  const inputUrls = new Set(extractPrUrls(opts.inputDescription).map((p) => p.url));
  return candidates.filter((p) => !inputUrls.has(p.url));
}

/**
 * Detect a README-clarity-gate stop in an autonomous run's events. The gate
 * emits an `emitResult` (`{type:"result", result}`) tagged with its phase label
 * whose text starts with {@link README_CLARITY_STOP_PREFIX} when it halts the
 * run for an unclear README. Returns that full message (reason + handoff) so the
 * notifier can post it, or `null` if the run wasn't stopped by the gate.
 */
export function extractClarityGateStop(events: OperationEvent[]): string | null {
  for (const e of events) {
    if (e.phaseLabel !== README_CLARITY_PHASE_LABEL) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(e.data);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const p = parsed as { type?: unknown; result?: unknown };
    if (p.type === "result" && typeof p.result === "string" && p.result.startsWith(README_CLARITY_STOP_PREFIX)) {
      return p.result;
    }
  }
  return null;
}

interface ParsedBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: { command?: string };
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

/** Pull `message.content[]` blocks from a stream-json event's stringified data.
 * Returns `[]` for non-JSON data or events without a message.content array. */
function getContentBlocks(data: string): ParsedBlock[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const msg = (parsed as { message?: unknown }).message;
  if (!msg || typeof msg !== "object") return [];
  const content = (msg as { content?: unknown }).content;
  return Array.isArray(content) ? (content as ParsedBlock[]) : [];
}

/** Flatten a tool_result `content` field, which can be a string or an array of
 * text blocks (`[{type:"text", text:"..."}]`). */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string"
      ? (c as { text: string }).text
      : ""))
    .join("\n");
}

/** Build the Slack message text for a completed autonomous run. */
export function buildCompletionMessage(prs: PrUrlInfo[]): string {
  if (prs.length === 0) return NO_PRS_MSG;
  const list = prs.map((p) => `• ${p.url}`).join("\n");
  return `Done! Created PRs:\n${list}`;
}
