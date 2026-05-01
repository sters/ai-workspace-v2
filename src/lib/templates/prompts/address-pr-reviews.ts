/**
 * Instruction template for the "Address PR Reviews" quick-fill button on the
 * update form. This is a user-facing instruction (not a Claude system prompt)
 * but is co-located with other prompt templates so it can be tuned in one place.
 */

export function getAddressPrReviewsInstruction(): string {
  return `Check the PR opened on the current branch using \`gh pr list\` and \`gh pr view\`, then read all review comments with \`gh pr view --comments\` and \`gh api\` for review threads. For each unresolved comment, judge whether it is valid given the current code and intent of the change:
- If valid and actionable: add it as a TODO item in the TODO file.
- If not valid (e.g. based on a misunderstanding, already addressed, out of scope, or a non-issue): do NOT add a TODO checkbox and do NOT reply to the comment on GitHub. Instead, record a brief entry under the \`## Notes\` section of the TODO file summarizing the comment, the decision not to act, and the reason (so the rationale is preserved alongside the TODO list and a human can decide whether to reply). If the \`## Notes\` section does not exist yet, create it.
- If unclear: add a TODO to investigate, and note what needs clarification.
Do not silently ignore any comment.`;
}
