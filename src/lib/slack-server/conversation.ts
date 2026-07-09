/**
 * Free-form, read-only Slack conversation backed by the Claude CLI.
 *
 * Each Slack thread maps to one Claude CLI session so follow-up messages in
 * the same thread continue the conversation (via `--resume`). The mapping is
 * persisted in SQLite (`slack_conversation_sessions`, see
 * `@/lib/db/slack-sessions`) so a thread survives a slack-server restart.
 *
 * The session inherits the ambient Claude permissions of the host (the same
 * `~/.claude/settings.json` every other operation runs under), so Bash, git,
 * gh, and MCP servers work wherever the environment already permits them.
 * Read-only behavior is NOT enforced at the tool layer — it is enforced by
 * the system prompt (`getSlackChatSystemPrompt`), see `slack-chat.ts`.
 * Mutations should still go through the WebUI or `init`.
 *
 * The one exception is per-user memory: when `slack.memoryEnabled` is set and a
 * Slack user id is known, the conversation is pointed at a dedicated SQLite
 * file (`@/lib/slack-server/memory-db`) it may read/write via `sqlite3` to
 * recall and persist facts across threads. The prompt scopes all access to the
 * current user's rows.
 */

import { runClaude } from "@/lib/claude";
import { getConfig, getResolvedWorkspaceRoot } from "@/lib/config";
import { deleteSession, getSession, setSession } from "@/lib/db/slack-sessions";
import { buildSlackChatPrompt } from "@/lib/templates/prompts";
import { ensureGlobalSystemPrompt } from "@/lib/workspace/prompts";
import { ensureSlackMemoryDb } from "./memory-db";
import { summarizeProgress } from "./progress-summary";

/**
 * Whether a live (non-expired) CLI session already exists for a thread. Used
 * by the handler to decide whether this is the first turn (and therefore
 * whether to fetch and fold in the thread transcript).
 */
export function hasThreadSession(threadKey: string): boolean {
  return getSession(threadKey, Date.now()) !== undefined;
}

/** Options for a conversation turn. */
export interface ConverseOptions {
  /** Slack user id of the mention author, used to scope memory. */
  userId?: string;
  /** Transcript of the surrounding Slack thread, folded into the first turn. */
  threadContext?: string;
  /**
   * Called periodically (every `slack.chatHeartbeatMs`) while the turn is still
   * running, with a one-line summary of the assistant's progress so far
   * (produced by `slack.chatProgressModel`, default haiku). The string is empty
   * when the model has only run tools, summarization is disabled, or the
   * summarizer failed — the caller should render a bare "still working" marker
   * in that case. Errors thrown by the callback are ignored.
   */
  onProgress?: (progress: string) => void | Promise<void>;
}

interface TurnResult {
  text: string;
  /** Whether the turn produced a usable answer. */
  ok: boolean;
  /**
   * Why the turn failed. `"error"` (fatal error or non-zero exit with no
   * output) is worth a fresh retry when we were resuming a session that may no
   * longer exist; `"timeout"` is not (it would just double the wait).
   */
  reason?: "error" | "timeout";
}

/**
 * Answer one conversation turn for the given Slack thread.
 *
 * `threadKey` should be stable per Slack thread (e.g. `thread_ts ?? ts`). The
 * first turn sends full instructions (working dir, memory, any thread
 * transcript); resume turns send only the message and rely on the CLI session
 * for context.
 *
 * Returns the assistant's reply text. Never throws — on failure it returns a
 * short human-readable error string suitable for posting to Slack.
 */
export async function converse(
  threadKey: string,
  message: string,
  opts: ConverseOptions = {},
): Promise<string> {
  const now = Date.now();
  const resumeSessionId = getSession(threadKey, now);
  const workspaceRoot = getResolvedWorkspaceRoot();
  const config = getConfig();

  // Memory DB path is only needed when building a first-turn prompt, so ensure
  // it lazily (and never on plain resume turns, which don't fold it in).
  let memoryDbPath: string | undefined;
  const memoryOpts = (): { memoryDbPath?: string; userId?: string } => {
    if (!config.slack.memoryEnabled || !opts.userId) return {};
    if (!memoryDbPath) memoryDbPath = ensureSlackMemoryDb(workspaceRoot);
    return { memoryDbPath, userId: opts.userId };
  };

  const runAttempt = (resume: string | undefined): Promise<TurnResult> => {
    const isFirstTurn = resume === undefined;
    const prompt = buildSlackChatPrompt(workspaceRoot, message, isFirstTurn, {
      threadContext: opts.threadContext,
      ...memoryOpts(),
    });
    return runTurn(threadKey, prompt, resume, config, opts.onProgress);
  };

  let result = await runAttempt(resumeSessionId);

  // The persisted session id may point at a CLI session that no longer exists
  // (e.g. after a restart, or once Claude pruned it). Drop it and retry once as
  // a fresh conversation so the thread doesn't get wedged.
  if (!result.ok && result.reason === "error" && resumeSessionId !== undefined) {
    deleteSession(threadKey);
    result = await runAttempt(undefined);
  }

  return result.text;
}

function runTurn(
  threadKey: string,
  prompt: string,
  resumeSessionId: string | undefined,
  config: ReturnType<typeof getConfig>,
  onProgress?: (progress: string) => void | Promise<void>,
): Promise<TurnResult> {
  const proc = runClaude("slack-chat", prompt, {
    cwd: getResolvedWorkspaceRoot(),
    // No allowedTools/addDirs: inherit the host's ambient Claude permissions
    // (same as every other operation). Read-only (plus the memory carve-out) is
    // enforced by the system prompt below, not at the tool layer.
    appendSystemPromptFile: ensureGlobalSystemPrompt("slack-chat"),
    resumeSessionId,
    skipAskUserQuestion: true,
    model: config.slack.chatModel ?? undefined,
    effort: config.slack.chatEffort ?? undefined,
  });

  const heartbeatMs = config.slack.chatHeartbeatMs;
  const maxTurnMs = config.slack.chatMaxTurnMs;

  return new Promise<TurnResult>((resolve) => {
    let settled = false;
    let summarizing = false;
    const finish = (result: TurnResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardCap);
      clearInterval(heartbeat);
      resolve(result);
    };

    // Interim progress: while the turn keeps running (no completion yet),
    // summarize what the assistant has said so far into a one-liner and post it
    // back to the thread. This turns a long investigation into a visible pulse
    // instead of a silent wait, without dumping raw output. Only one summary is
    // in flight at a time; an empty snapshot or disabled/failed summarization
    // yields a bare liveness marker (empty string to onProgress).
    const heartbeat = setInterval(() => {
      if (settled || !onProgress || summarizing) return;
      const progress = proc.getAssistantText().trim();
      const model = config.slack.chatProgressModel;
      if (!progress || !model) {
        void Promise.resolve(onProgress("")).catch(() => {});
        return;
      }
      summarizing = true;
      void summarizeProgress(progress, model)
        .then((summary) => {
          if (settled || !onProgress) return;
          return onProgress(summary ?? "");
        })
        .catch(() => {})
        .finally(() => {
          summarizing = false;
        });
    }, heartbeatMs);

    const hardCap = setTimeout(() => {
      proc.kill();
      // Persist whatever session the CLI reported before the timeout so the
      // next message in this thread resumes it (continuing the work) and the
      // logged id can be inspected via `claude --resume`.
      const sessionId = proc.getSessionId();
      if (sessionId) {
        setSession(threadKey, sessionId, Date.now());
        console.warn(
          `[slack-chat] turn hit the ${maxTurnMs}ms cap; persisted session ${sessionId} for thread ${threadKey} — resume to continue`,
        );
      } else {
        console.warn(
          `[slack-chat] turn hit the ${maxTurnMs}ms cap for thread ${threadKey} (no session id captured)`,
        );
      }
      finish({
        ok: false,
        reason: "timeout",
        text: "Sorry, that took too long and I gave up. The work so far is saved — reply in this thread to continue.",
      });
    }, maxTurnMs);

    proc.onEvent((event) => {
      if (event.type === "error") {
        finish({ ok: false, reason: "error", text: "Sorry, something went wrong while I was thinking." });
        return;
      }
      if (event.type !== "complete") return;

      const sessionId = proc.getSessionId();
      if (sessionId) setSession(threadKey, sessionId, Date.now());
      const text = proc.getResultText()?.trim();
      if (text && text.length > 0) {
        finish({ ok: true, text });
        return;
      }
      // No output. A non-zero exit usually means the turn genuinely failed
      // (e.g. a stale --resume target); flag it so the caller can retry fresh.
      const failed = exitCodeOf(event.data) !== 0;
      finish(
        failed
          ? { ok: false, reason: "error", text: "Sorry, something went wrong while I was thinking." }
          : { ok: true, text: "(no response)" },
      );
    });
  });
}

/** Best-effort parse of `{ exitCode }` from a `complete` event's data. */
function exitCodeOf(data: unknown): number {
  if (typeof data !== "string") return 0;
  try {
    const parsed = JSON.parse(data) as { exitCode?: unknown };
    return typeof parsed.exitCode === "number" ? parsed.exitCode : 0;
  } catch {
    return 0;
  }
}
