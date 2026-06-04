/**
 * Instruction template for the "Address PR Reviews" quick-fill button on the
 * update form. This is a user-facing instruction (not a Claude system prompt)
 * but is co-located with other prompt templates so it can be tuned in one place.
 */

export function getAddressPrReviewsInstruction(): string {
  return `Check the PR opened on the current branch using \`gh pr list\` and \`gh pr view\`, then gather feedback from two sources:

1. **Review comments**: read all review comments with \`gh pr view --comments\` and \`gh api\` for review threads.
2. **Failing CI checks**: run \`gh pr checks\` and, for every job in a non-passing state (fail/cancelled/action_required, not skipping/pending), fetch its log with \`gh run view --job <job-id> --log-failed\` (fall back to \`--log\` if \`--log-failed\` is empty) and identify the root cause from the actual error messages — do not rely on the job name alone.

For each unresolved review comment AND each failing CI job, judge whether it is valid and actionable given the current code and intent of the change:
- If valid and actionable: add it as a TODO item in the TODO file. For CI failures, the TODO must name the failing job and quote the key error line so the executor can act without re-running \`gh\`.
- If not valid (e.g. based on a misunderstanding, already addressed, out of scope, a non-issue, or — for CI — a known-flaky / infrastructure / unrelated-to-this-PR failure): do NOT add a TODO checkbox and do NOT reply to the comment on GitHub. Instead, record a brief entry under the \`## Notes\` section of the TODO file summarizing the item, the decision not to act, and the reason (so the rationale is preserved alongside the TODO list and a human can decide whether to reply or re-run CI). If the \`## Notes\` section does not exist yet, create it.
- If unclear: add a TODO to investigate, and note what needs clarification.

Do not silently ignore any comment or any failing CI job.`;
}
