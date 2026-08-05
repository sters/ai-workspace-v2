/**
 * The instruction behind the Pull Requests tab's **triage** button.
 *
 * Like `getAddressPrReviewsInstruction` this is a user-facing instruction rather
 * than a system prompt — it becomes the `instruction` of an autonomous run
 * starting at `update-todo` — and it lives here so the wording is tuned next to
 * the prompts it feeds.
 *
 * The difference from that quick-fill is who judged. `Address PR Reviews` starts
 * from a PR nobody has looked at: it fetches every thread and decides validity
 * itself. Triage starts from threads a human already picked, so re-litigating
 * them would silently drop work that was explicitly asked for. What this
 * instruction has to supply instead is everything the run would otherwise re-fetch
 * (the comment bodies, the thread ids) and everything it must not do (reply,
 * resolve, or widen past the listed threads).
 *
 * The `## PR Review Threads` rows are the load-bearing part. `create-pr` reads
 * that section back after a successful push to reply to and resolve each thread
 * whose item is done, and non-checkbox table rows are what survives
 * `stripCompletedTodoItems` deleting the `[x]` items worth replying about.
 */

import { PR_REVIEW_THREADS_HEADING } from "@/lib/parsers/todo";
import type { PrThreadValidation } from "@/types/pull-request";

/**
 * A recorded validation as this instruction reads it.
 *
 * Lives here rather than beside the store because the store reaches for
 * `node:path` and `Bun`, and the tab's triage button builds this instruction in
 * the browser — importing the store from a client component would drag both into
 * the client bundle.
 */
export function renderValidationForPrompt(validation: PrThreadValidation): string {
  const lines = [
    `Validation verdict: **${validation.verdict}** (recorded ${validation.validatedAt})`,
    `- What the reviewer is asking for: ${validation.interpretation}`,
    `- How it stands against the code: ${validation.reasoning}`,
    `- Recommended action: ${validation.recommendation}`,
  ];
  if (validation.evidence.length > 0) {
    lines.push(`- Evidence: ${validation.evidence.join(", ")}`);
  }
  return lines.join("\n");
}

/** One selected review thread, flattened to what a triage needs to see. */
export interface TriageThread {
  /** GraphQL thread node id (`PRRT_…`) — the key `create-pr` replies by. */
  id: string;
  repoName: string;
  prUrl: string;
  path: string | null;
  line: number | null;
  commentUrl: string;
  author: string;
  /** The thread's comments, already flattened into one block of text. */
  body: string;
}

function renderThread(
  thread: TriageThread,
  index: number,
  validation: PrThreadValidation | undefined,
): string {
  const location = thread.path
    ? `\`${thread.path}\`${thread.line != null ? `:${thread.line}` : ""}`
    : "(not anchored to a file)";

  const validationBlock = validation
    ? `\n**Prior validation** (an agent already looked at this comment):

${renderValidationForPrompt(validation)}

Treat that as a starting point, not as the plan: it was written before this triage and you should still check its claims against the code as it is now.${
        validation.verdict === "invalid"
          ? ` Note the verdict was **invalid** and a human chose to act on the comment anyway — that override is deliberate, so plan the work rather than declining it, and record the tension in the TODO item.`
          : ""
      }\n`
    : "";

  return `### ${index}. ${thread.repoName} — ${location}

- Repository: **${thread.repoName}** (its TODO file is \`TODO-${thread.repoName}.md\`)
- Pull request: ${thread.prUrl}
- Comment: ${thread.commentUrl}
- Thread ID: \`${thread.id}\`
- Comment author: ${thread.author}

\`\`\`
${thread.body}
\`\`\`
${validationBlock}`;
}

export function buildTriagePrCommentsInstruction(input: {
  threads: TriageThread[];
  /** Recorded validate results, keyed by thread id. Absent for a direct triage. */
  validations?: Record<string, PrThreadValidation>;
}): string {
  const { threads, validations } = input;
  if (threads.length === 0) return "";

  const rendered = threads
    .map((thread, i) => renderThread(thread, i + 1, validations?.[thread.id]))
    .join("\n");

  const repoNames = [...new Set(threads.map((t) => t.repoName))];
  const plural = threads.length === 1 ? "thread" : "threads";

  return `Turn the following ${threads.length} PR review ${plural} into TODO items. A human read each one and already decided it is valid and worth doing, so do not re-judge whether to act on it — plan the work.

Everything you need is below. Do NOT run \`gh pr view\` or re-fetch the threads: the comment bodies, thread IDs and locations are already here, and the PR may have moved on since.

Work on **only the ${plural} listed below** and nothing else. Other comments on the same PR, other findings you notice in passing, and other improvements to the same files are out of scope for this run — a human will select them if they want them.

## Threads to triage

${rendered}
## What to write

For each thread, add a TODO item to \`TODO-<repo>.md\` for the repository the thread belongs to (${repoNames
    .map((r) => `\`TODO-${r}.md\``)
    .join(", ")}). The item must name the file and the change concretely enough to implement without going back to the PR, and its \`Verify:\` must state how the fix is proved.

Where a thread's fix is genuinely more than one unit of work, write more than one item for it — but every item must trace back to a listed thread.

## Recording the threads

Append (or extend) a \`## ${PR_REVIEW_THREADS_HEADING}\` section at the end of each TODO file you touch, with one row per thread you turned into an item in that file:

\`\`\`markdown
## ${PR_REVIEW_THREADS_HEADING}

| Thread ID | Comment URL | Summary | TODO item |
|---|---|---|---|
| PRRT_kwDO... | https://github.com/o/r/pull/12#discussion_r123 | Missing nil check before deref | **[api/handler.go]** Add nil check before deref |
\`\`\`

- **Thread ID** is the \`PRRT_\`-prefixed id given for each thread above.
- **TODO item** must repeat the TODO item's first line **verbatim**, so it can be matched against the file after the work is done.
- Use table rows, not checkboxes — this section is a record, not work to do.
- Keep any rows already in the section and add yours to the same table.

**Do NOT reply to any review comment and do NOT resolve any thread now.** The fix does not exist yet, so a reply would speak for work that has not happened. A later phase replies and resolves after the fix is committed and pushed, using the rows above — a thread whose item is complete gets a reply and is resolved, and a thread whose item is still pending, in progress or blocked is left open for the human.`;
}
