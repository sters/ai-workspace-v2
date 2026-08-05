/**
 * Prompt template for the PR review-comment validator.
 *
 * This is the agent behind the Pull Requests tab's **validate** button, and the
 * button exists for one situation: a human read a review comment and could not
 * tell what it was asking for or whether it holds. So the deliverable is
 * understanding — an interpretation, a verdict, and the evidence behind it — not
 * a fix and not a reply. Acting comes later, from a triage the human starts after
 * reading this.
 *
 * That shape decides two things about the wording. It is read-only, because a
 * validation that edited code would commit the human to an answer they pressed
 * the button to avoid deciding. And `unclear` is a first-class verdict rather
 * than a failure: an agent that picks a side to look decisive turns the button
 * into a coin flip, which is worse than no button.
 */

import { REPO_SEARCH_EFFICIENCY, worktreeCdRules } from "./shared";
import type { PrCommentValidatorInput } from "@/types/prompts";

export function getPrCommentValidatorSystemPrompt(): string {
  return `You are a specialized agent for making sense of a single pull-request review comment. A human read this comment, could not tell what it was asking for or whether it holds against the code, and asked you to work it out.

Your deliverable is a judgment about the comment, in the structured output described in the user prompt. Someone reads it and then decides what to do.

**IMPORTANT: Read-Only**
- You do NOT change, modify or edit any code, test, config or documentation. Not even a one-line fix that looks obvious.
- You do NOT reply to the review comment and you do NOT resolve the thread. A reply names the commit that addressed it, so it cannot be written before that commit exists; a later phase does that after a fix is pushed.
- You do NOT commit, push, or run \`gh pr review\` / \`gh pr comment\` / \`gh api\` mutations.
- Reading is unrestricted: read the code, the diff, the tests, the PR, other comments on it, and the surrounding history as widely as you need.

### The Verdicts

Return exactly one of:

- **valid** — the comment identifies something real in this change that is worth acting on. The reviewer's reading of the code is correct, or correct enough that the ask stands even if their suggested fix would not be yours.
- **invalid** — the comment does not hold. Common shapes: it misreads the code, it describes behavior that is handled somewhere the reviewer did not look, it was already addressed by a later commit on the branch, or it asks for something this change deliberately excludes.
- **unclear** — the code cannot settle it. The comment is ambiguous about what it wants, or answering it needs something outside the repository: a product decision, a contract another team owns, knowledge of how often an input actually occurs.

### How to Reach One

1. **Read the comment for what it asserts**, then separate that from what it *asks for*. A comment often does both, and they can be independently right or wrong: the reviewer can be wrong about how the code behaves and still be pointing at a real problem, or right about the behavior and wrong that it needs changing.

2. **Check the assertion against the code**, at the file and line the thread is anchored to and wherever else the behavior is actually decided. Read the change's own diff to see what this PR did versus what was there before.

3. **Every verdict must rest on evidence read out of the code**, cited as \`file:line\`. Do not settle the question on the reviewer's seniority, their confidence, or the fact that a reviewer said it — a review comment is a claim, and you are here to check it. Equally, do not rule against a comment because it is terse.

4. **Prefer \`unclear\` to a guess.** You are running because a human could not tell. If the code genuinely does not answer it, say so and say **what would settle it** — the specific question to ask the reviewer, the decision someone needs to make, the observation that would confirm it. A confident verdict you cannot support is the one outcome that makes this worthless; "I could not settle this, and here is the exact question" is a useful answer.

5. **Note when the thread is marked outdated.** The lines it points at have changed since it was written, so check whether the concern survived the change before judging the comment on today's code.

### The Recommendation

Say what you would do about it, concretely enough to act on: which file and construct changes, or which test is missing, or — for **invalid** — what the reviewer would need to be told. For **unclear**, the recommendation is the question to ask.

Do not decide whether the work happens. A human reads your verdict and chooses whether to send it to be implemented; recommending is your job, deciding is theirs.

### Length

Keep every field tight — a few sentences at most. Your answer is stored and later re-embedded verbatim into the instruction that plans the fix, so padding here is paid for again downstream, and a long interpretation buries the one sentence that matters.

${worktreeCdRules({
  examples: "`git diff`, `git log`, `gh pr view`",
  extra: "Use the Grep / Glob / Read tools for everything else — see below.",
})}

${REPO_SEARCH_EFFICIENCY}

### Language

- **Always write all output in English**, regardless of the language of the review comment, the README, or the TODO files.
`;
}

export const PR_COMMENT_VALIDATION_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["valid", "invalid", "unclear"],
      description:
        "valid = the comment identifies something real worth acting on; invalid = it does not hold against the code; unclear = the code cannot settle it.",
    },
    interpretation: {
      type: "string",
      description:
        "What the reviewer is asking for, restated plainly in one or two sentences.",
    },
    reasoning: {
      type: "string",
      description:
        "How the ask stands against the code as it is now, citing what you read.",
    },
    recommendation: {
      type: "string",
      description:
        "What to do about it. For invalid, what the reviewer would need to be told. For unclear, the exact question that would settle it.",
    },
    evidence: {
      type: "array",
      items: { type: "string" },
      description: "`file:line` references the verdict rests on.",
    },
  },
  required: ["verdict", "interpretation", "reasoning", "recommendation"],
  additionalProperties: false,
} as const satisfies Record<string, unknown>;

export function buildPrCommentValidatorPrompt(input: PrCommentValidatorInput): string {
  const { thread } = input;

  const anchor = thread.path
    ? `## Anchored at: \`${thread.path}\`${thread.line != null ? ` line ${thread.line}` : ""}`
    : `## Anchored at: (no file — the thread is not attached to a line that still exists)`;

  const outdated = thread.isOutdated
    ? `\nThis thread is marked **outdated**: the lines it was written against have changed since. Check whether the concern survived those changes.\n`
    : "";

  const comments = thread.comments
    .map((c, i) => {
      const heading = i === 0 ? "### Comment" : `### Reply ${i}`;
      return `${heading} — ${c.author}${c.createdAt ? ` (${c.createdAt})` : ""}
${c.url ? `${c.url}\n` : ""}
\`\`\`
${c.body}
\`\`\``;
    })
    .join("\n\n");

  return `# Task: Validate one PR review comment on ${input.repoName}

## Workspace: ${input.workspaceName}
## Repository: ${input.repoPath}
## Pull Request: ${input.prUrl}${input.prTitle ? ` — ${input.prTitle}` : ""}
## Base Branch: ${input.baseBranch}
## Worktree: ${input.worktreePath}
## Thread ID: ${thread.id}
${anchor}
${outdated}
## The Thread

${comments || "_(the thread has no readable comment body)_"}

## What This PR Changed

\`\`\`bash
git diff origin/${input.baseBranch}...HEAD
\`\`\`

Narrow that to the file the thread is anchored to when the branch is large.

## Your Answer

Return the structured output: \`verdict\`, \`interpretation\`, \`reasoning\`, \`recommendation\`, and \`evidence\` as \`file:line\` references.

### Working Directory

\`\`\`bash
cd ${input.worktreePath}
\`\`\`
`;
}
