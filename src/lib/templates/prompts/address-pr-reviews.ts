/**
 * Instruction template for the "Address PR Reviews" quick-fill button on the
 * update form. This is a user-facing instruction (not a Claude system prompt)
 * but is co-located with other prompt templates so it can be tuned in one place.
 */

export function getAddressPrReviewsInstruction(): string {
  return `Check the PR opened on the current branch using \`gh pr list\` and \`gh pr view\`, then read all review comments with \`gh pr view --comments\` and \`gh api\` for review threads. For each unresolved comment, judge whether it is valid given the current code and intent of the change:
- If valid and actionable: add it as a TODO item in the TODO file.
- If not valid (e.g. based on a misunderstanding, already addressed, out of scope, or a non-issue): do NOT add a TODO checkbox. Instead, (1) reply to that comment via \`gh api\` with a clear, well-reasoned justification for why no change is needed — match the language of the original comment (Japanese comments get Japanese replies, English gets English, etc.) and keep the tone respectful and specific, citing code or context rather than dismissing, AND (2) record a brief entry under the \`## Notes\` section of the TODO file summarizing the comment, the decision not to act, and the reason (so the rationale is preserved alongside the TODO list). If the \`## Notes\` section does not exist yet, create it.
- If unclear: add a TODO to investigate, and note what needs clarification.
Do not silently ignore any comment.`;
}
