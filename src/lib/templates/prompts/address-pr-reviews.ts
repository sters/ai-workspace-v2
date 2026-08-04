/**
 * Instruction template for the "Address PR Reviews" quick-fill button on the
 * update form. This is a user-facing instruction (not a Claude system prompt)
 * but is co-located with other prompt templates so it can be tuned in one place.
 */

import { PR_REVIEW_THREADS_HEADING } from "@/lib/parsers/todo";

export function getAddressPrReviewsInstruction(): string {
  return `Check the PR opened on the current branch using \`gh pr list\` and \`gh pr view\`, then gather feedback from two sources:

1. **Review comments**: read all review comments with \`gh pr view --comments\` and \`gh api\` for review threads. Fetch the thread node IDs too — you will need them below:
   \`\`\`
   gh api graphql -f query='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved isOutdated path line comments(first:5){nodes{url author{login} body}}}}}}}' -F owner=<owner> -F name=<repo> -F number=<pr-number>
   \`\`\`
   Ignore threads where \`isResolved\` is already true — they are settled.
2. **Failing CI checks**: run \`gh pr checks\` and, for every job in a non-passing state (fail/cancelled/action_required, not skipping/pending), fetch its log with \`gh run view --job <job-id> --log-failed\` (fall back to \`--log\` if \`--log-failed\` is empty) and identify the root cause from the actual error messages — do not rely on the job name alone.

For each unresolved review comment AND each failing CI job, judge whether it is valid and actionable given the current code and intent of the change:
- If valid and actionable: add it as a TODO item in the TODO file. For CI failures, the TODO must name the failing job and quote the key error line so the executor can act without re-running \`gh\`. For review comments, also record the thread in the \`## ${PR_REVIEW_THREADS_HEADING}\` section described below.
- If not valid (e.g. based on a misunderstanding, already addressed, out of scope, a non-issue, or — for CI — a known-flaky / infrastructure / unrelated-to-this-PR failure): do NOT add a TODO checkbox and do NOT record it in \`## ${PR_REVIEW_THREADS_HEADING}\`. Instead, record a brief entry under the \`## Notes\` section of the TODO file summarizing the item, the decision not to act, and the reason (so the rationale is preserved alongside the TODO list and a human can decide whether to reply or re-run CI). If the \`## Notes\` section does not exist yet, create it.
- If unclear: add a TODO to investigate, and note what needs clarification.

## Recording review threads

Append (or create) a \`## ${PR_REVIEW_THREADS_HEADING}\` section at the end of the TODO file, holding one table row per review comment you turned into a TODO item:

\`\`\`markdown
## ${PR_REVIEW_THREADS_HEADING}

| Thread ID | Comment URL | Summary | TODO item |
|---|---|---|---|
| PRRT_kwDO... | https://github.com/o/r/pull/12#discussion_r123 | Missing nil check before deref | **[api/handler.go]** Add nil check before deref |
\`\`\`

- **Thread ID** is the GraphQL \`id\` from the query above (it starts with \`PRRT_\`), not the comment's numeric id.
- **TODO item** must repeat the TODO item's first line verbatim, so it can be matched against the file later.
- Use table rows, not checkboxes — this section is a record, not work to do.
- Keep any rows already in the section; add yours to the same table.

**Do NOT reply to any review comment and do NOT resolve any thread yourself.** A later phase does that after the fix has been committed and pushed, using the rows above: a thread whose TODO item is complete gets a reply and is resolved, and a thread whose item is still pending, in progress or blocked is left open. Replying now would speak for work that does not exist yet.

Do not silently ignore any comment or any failing CI job.`;
}
