/**
 * Compress an in-progress conversation turn's assistant text into a single
 * short status line, using a cheap model (default haiku). Used by the Slack
 * conversation heartbeat so a long turn shows "roughly what it's doing right
 * now" instead of dumping raw assistant output into the thread.
 *
 * This is a one-shot, throwaway `runClaude` call: no session is captured or
 * resumed, and failures/timeouts resolve to `undefined` so the caller can fall
 * back to a bare liveness marker. It deliberately carries no slack-chat system
 * prompt — it's a neutral summarizer, not part of the conversation.
 */

import { runClaude } from "@/lib/claude";
import { getResolvedWorkspaceRoot } from "@/lib/config";
import type { ClaudeModel } from "@/types/claude";

/** Give up on a summary this quickly — it's only a status line, never worth a wait. */
const SUMMARY_TIMEOUT_MS = 30_000;

function buildPrompt(log: string): string {
  return [
    "You are a status-line summarizer. Below is the running log of an assistant's",
    "own messages while it works on a task. In ONE short sentence (max ~20 words,",
    "present tense, no preamble, no markdown), say what it is currently doing or has",
    "just found. Do NOT use any tools. Output ONLY that sentence.",
    "",
    "<log>",
    log,
    "</log>",
  ].join("\n");
}

/**
 * Summarize `assistantText` into a one-line status via `model`. Returns the
 * trimmed sentence, or `undefined` when the text is empty, the model produces
 * nothing, or the call errors / times out.
 */
export function summarizeProgress(
  assistantText: string,
  model: ClaudeModel,
): Promise<string | undefined> {
  const text = assistantText.trim();
  if (!text) return Promise.resolve(undefined);

  const proc = runClaude("slack-progress", buildPrompt(text), {
    cwd: getResolvedWorkspaceRoot(),
    model,
    skipAskUserQuestion: true,
  });

  return new Promise<string | undefined>((resolve) => {
    let settled = false;
    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      proc.kill();
      finish(undefined);
    }, SUMMARY_TIMEOUT_MS);

    proc.onEvent((event) => {
      if (event.type === "error") {
        finish(undefined);
        return;
      }
      if (event.type !== "complete") return;
      finish(proc.getResultText()?.trim() || undefined);
    });
  });
}
