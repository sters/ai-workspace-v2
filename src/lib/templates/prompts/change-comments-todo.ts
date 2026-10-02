/**
 * The instruction behind the Changes tab's **Make TODOs** button: the comments
 * the user left on lines of the workspace's diff, as the `instruction` of the
 * `update-todo` phase an `autonomous` run starts with.
 *
 * Like the Pull Requests tab's triage, the comments come from a human who has
 * already decided they want the work, so the instruction asks for them to be
 * planned rather than judged. Unlike it, the author is the workspace's own user
 * writing on their own uncommitted work, so there is no thread to reply to and
 * nothing to record for `create-pr`.
 *
 * Built in the browser, so it imports nothing with node dependencies.
 */

import { locateComment, quoteDiff, type ChangeComment } from "@/lib/change-comments";

function renderComment(comment: ChangeComment, index: number): string {
  return `### ${index}. ${locateComment(comment)}

- TODO file: \`TODO-${comment.repoName}.md\`

${quoteDiff(comment.text)}

${comment.comment.trim()}`;
}

export function buildChangeCommentsTodoInstruction(comments: ChangeComment[]): string {
  return `Turn the review comments below into TODO items. I wrote each one on lines of this workspace's changes — every worktree diffed against its base branch, uncommitted work included — and the lines it is about are quoted under it. Paths are relative to the workspace directory.

Each comment is a request I have already decided I want, not a claim to evaluate: plan the change it asks for, in the TODO file of the repository it is in. Read the code around the quoted lines before writing the item, so its Target names the real site rather than the quote. Comments asking for the same change may share one item. A comment phrased as a question becomes an item that answers it from the code and acts on the answer; if only I can answer it, add it as \`[!]\` blocked with the question.

Plan only what these comments ask for — the rest of the diff is not part of this request.

${comments.map((c, i) => renderComment(c, i + 1)).join("\n\n")}
`;
}
