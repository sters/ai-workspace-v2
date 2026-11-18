/**
 * Prompt for the `check-pr-triage` operation: given one PR's whole conversation
 * and the comments proposed for triage, say which of them still need anything.
 *
 * Everything the judge needs is in the prompt, so it reads no code. The answer
 * only hides a proposal, so an unsure call stays `open`.
 */

import { fenceFor } from "@/lib/change-comments";
import type { PrReviewThread } from "@/types/pull-request";

const MAX_BODY_CHARS = 2000;

export const PR_TRIAGE_JUDGE_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string", description: "The comment's permalink, exactly as given." },
          verdict: { type: "string", enum: ["addressed", "open"] },
          reason: { type: "string", description: "One sentence, max 200 chars." },
        },
        required: ["url", "verdict", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

function threadHeading(t: PrReviewThread): string {
  const where = t.kind === "review-thread" ? `inline on ${t.path ?? "(removed lines)"}${t.line ? `:${t.line}` : ""}` : t.kind;
  const state = t.isResolved ? (t.kind === "review-thread" ? "resolved" : "hidden") : "open";
  return `### ${where} — ${state}${t.isOutdated ? ", outdated" : ""}${t.reviewState ? `, review ${t.reviewState}` : ""}`;
}

function renderThread(t: PrReviewThread, targets: Set<string>): string {
  const comments = t.comments.map((c) => {
    const body = c.body.length > MAX_BODY_CHARS ? `${c.body.slice(0, MAX_BODY_CHARS)}…` : c.body;
    const fence = fenceFor(body);
    const mark = targets.has(c.url) ? " **[JUDGE]**" : "";
    return `- ${c.url}${mark} — ${c.author ?? "unknown"} at ${c.createdAt}\n${fence}\n${body}\n${fence}`;
  });
  return `${threadHeading(t)}\n${comments.join("\n")}`;
}

export function buildPrTriageJudgePrompt(input: {
  prUrl: string;
  prTitle: string;
  /** The gh user's login: the PR author's side of the conversation. */
  self: string | null;
  threads: PrReviewThread[];
  targetUrls: string[];
  /** `git log` lines of the branch, newest first. */
  commits: string;
}): string {
  const targets = new Set(input.targetUrls);
  const conversation = [...input.threads]
    .sort((a, b) => (a.comments[0]?.createdAt ?? "").localeCompare(b.comments[0]?.createdAt ?? ""))
    .map((t) => renderThread(t, targets))
    .join("\n\n");

  return `# Do These PR Comments Still Need Anything?

Pull request: ${input.prUrl} — ${input.prTitle}
The PR's side of the conversation is written as \`${input.self ?? "the PR author"}\`.

The comments marked **[JUDGE]** below were proposed for triage: someone may need to change code or reply. For each, decide from this page alone whether it still needs anything. Answer directly from what is written here.

- **addressed** — nothing is left to do. For example: the PR's side replied with a fix or a reasoned decline and the reviewer did not push back; a commit below clearly does what it asked; it is a summary whose every point is covered by inline threads that are resolved or answered; it asks nothing (praise, an FYI, an automated report with no failure).
- **open** — anything else, including when you are unsure. A review summary that raises a point no inline thread covers is open.

Every [JUDGE] URL appears exactly once in \`results\`, copied exactly.

## Branch commits

${input.commits.trim() || "(none read)"}

## Conversation

${conversation}
`;
}
