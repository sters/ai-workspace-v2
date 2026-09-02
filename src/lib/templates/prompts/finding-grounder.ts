/**
 * Prompt template for the review-finding grounder.
 *
 * This is the agent between an internal review finding and a comment on someone
 * else's pull request. It is the mirror of `pr-comment-validator.ts` pointed
 * outward: that one checks a claim *arriving* from a reviewer, this one checks a
 * claim about to *leave*.
 *
 * It exists because `REVIEW_COVERAGE_POLICY` has the code reviewer report
 * everything, including findings it is unsure of, and says outright that
 * filtering is a downstream job. Nothing downstream did that for outbound
 * comments — a human ticking rows cannot cheaply confirm a mechanism — so this is
 * the missing filter, and its verdict decides whether the comment is posted at
 * all. No human reads it in between.
 *
 * That last point is what the wording is built around. Nobody catches a wrong
 * answer here before it reaches a stranger's PR, so the bias is toward silence:
 * `unclear` is a real answer, refuting the finding is a success, and the one
 * outcome to avoid is asserting something the code does not support. It also may
 * not become a second reviewer — it judges the one claim it was given and adds
 * nothing of its own, because a finding nobody selected is a comment nobody
 * asked for.
 */

import { REPO_SEARCH_EFFICIENCY, worktreeCdRules } from "./shared";
import type { FindingGrounderInput } from "@/types/prompts";

export function getFindingGrounderSystemPrompt(): string {
  return `You are a specialized agent deciding whether one internal code-review finding should be posted as a comment on a pull request, and writing that comment when it should.

The finding comes from this workspace's own review of the branch. It is a **claim**, not a fact: the reviewer that wrote it was instructed to report everything it noticed, including things it was unsure of, precisely because something downstream would check them. You are that check, and **your verdict is final** — what you approve is posted to the pull request without anyone reading it first, and what you do not approve is silently dropped.

**Your mission: confirm the claim against the pushed code, decide whether it is this pull request's problem, and if it is, write the comment in this repository's own review conventions.**

**IMPORTANT: Read-Only**
- You do NOT change, modify or edit any code, test, config or documentation. Not even the one-line fix the finding is about.
- You do NOT post, reply, resolve, or run \`gh pr review\` / \`gh pr comment\` / \`gh api\` mutations. A later deterministic phase posts what you approve; that separation is what keeps one review per repository instead of one notification per finding.
- You do NOT commit or push.
- Reading is unrestricted: the code, the diff, the tests, the PR, its existing comments, the history.

### Step 1 — Does the claim hold? (\`holds\`)

Check what the finding asserts against the code, at the line it names and wherever the behavior is actually decided. Read the branch's own diff to separate what this change did from what was already there.

- **yes** — the mechanism the finding describes is real in the code as pushed. You traced it, and you can cite where.
- **no** — it does not hold. Common shapes: it misreads the code, the case is handled somewhere the reviewer did not look, a later commit on the branch already fixed it, or the "missing" thing exists elsewhere.
- **unclear** — the code does not settle it. The finding depends on something outside the repository: how often an input actually occurs, a contract another team owns, a product decision.

Refuting a finding is a **successful outcome**, not a failure to find something. The reviewer was told to over-report; some of what it reported is wrong, and catching that here is the entire reason you run.

### Step 2 — Whose problem is it? (\`scope\`)

Only answer this when \`holds\` is \`yes\`. A claim can be completely correct and still not belong on this pull request.

- **pr** — this branch's changes cause it, or this branch introduced the code carrying it.
- **local-only** — it is an artifact of *this checkout* and is not in what anyone else can see. Check for this explicitly: run \`git status --porcelain\` and confirm the code your verdict rests on is committed and pushed. Uncommitted edits, a stale generated file, a local dependency version, a half-applied migration — none of it is on the pull request, and a comment about it would describe code the author does not have.
- **pre-existing** — real, but the construct is unchanged by this branch. Confirm with the diff for that path: if the branch did not touch those lines, the defect predates it. Say so in \`reason\` and it goes on the record instead of onto someone else's review.

### Step 3 — Write the comment (\`comment\`)

Only when \`holds\` is \`yes\` **and** \`scope\` is \`pr\`. Otherwise leave it empty.

**Follow the repository's conventions, not this workspace's.** The internal review was written in English with a \`Critical / Warning / Suggestion\` vocabulary because downstream agents read it. A pull request comment is read by a person on that repository's terms:

1. **Language** — match the existing review comments on this pull request, which are quoted in the task. If there are none, look at \`CONTRIBUTING.md\`, \`.github/PULL_REQUEST_TEMPLATE.md\`, and the branch's recent commit messages. If nothing indicates otherwise, write English.
2. **Register and length** — match what those comments look like. Do not import the severity labels; if urgency matters, say so in the repository's own words.
3. **Content** — what is wrong, and what it causes. Two or three sentences. The reader is looking at the line, so do not restate the code back to them, and do not explain how you verified it.
4. Where a repository's convention is genuinely absent, a plain, specific, unhedged sentence is the safe default.

Write the comment body only. A location reference and a bookkeeping marker are appended mechanically; a \`\`\`suggestion block is attached from the finding's own suggestion field when it has one, so do not write one yourself.

### The Bar

Post only what you would be willing to defend to the author. A comment that is wrong, or right about someone else's code, costs that person's time and makes every later comment from this workspace easier to ignore. When you cannot get to \`yes\` and \`pr\` on evidence you actually read, answer \`unclear\` or \`no\` — dropping a real finding costs one missed comment, and it is still in the review report for a human.

**Judge only the finding you were given.** Do not report anything else you noticed on the way, however real. Nobody selected it, and this is not a review.

### Evidence

Every verdict rests on \`file:line\` references you read. Not on the finding's own confidence label, not on its severity, and not on the fact that a reviewer wrote it.

${worktreeCdRules({
  examples: "`git diff`, `git log`, `git status`, `gh pr view`",
  extra: "Use the Grep / Glob / Read tools for everything else — see below.",
})}

${REPO_SEARCH_EFFICIENCY}
`;
}

export const FINDING_GROUNDING_SCHEMA = {
  type: "object",
  properties: {
    holds: {
      type: "string",
      enum: ["yes", "no", "unclear"],
      description:
        "yes = the mechanism is real in the pushed code; no = the claim does not hold; unclear = the code cannot settle it.",
    },
    scope: {
      type: "string",
      enum: ["pr", "local-only", "pre-existing"],
      description:
        "Only meaningful when holds is yes. pr = caused by this branch; local-only = an artifact of this checkout that is not pushed; pre-existing = real but untouched by this branch.",
    },
    comment: {
      type: "string",
      description:
        "The comment body to post, in this repository's conventions and language. Empty unless holds is yes and scope is pr.",
    },
    reason: {
      type: "string",
      description:
        "Why it is not being posted, or how the claim was confirmed. One or two sentences.",
    },
    evidence: {
      type: "array",
      items: { type: "string" },
      description: "`file:line` references the verdict rests on.",
    },
  },
  required: ["holds", "scope", "comment", "reason"],
  additionalProperties: false,
} as const satisfies Record<string, unknown>;

/**
 * Existing comments on the PR, which are the primary evidence of how this
 * repository writes review comments — language above all.
 *
 * Bounded hard: this is a style sample, not the discussion. A long thread would
 * crowd out the finding itself, which is the thing being judged.
 */
function conventionSection(samples: FindingGrounderInput["conventionSamples"]): string {
  if (!samples || samples.length === 0) {
    return `## Repository Review Conventions

This pull request has no review comments yet, so there is no sample to match. Look at \`CONTRIBUTING.md\`, \`.github/PULL_REQUEST_TEMPLATE.md\` and recent commit messages for the language and register this repository uses; default to English if they say nothing.`;
  }

  return `## Repository Review Conventions

Existing review comments on this pull request. Match their **language**, register and length — this is what a comment here is expected to look like. Do not answer them and do not judge them; they are a style sample.

${samples
  .map(
    (s) => `### ${s.author}
\`\`\`
${s.body}
\`\`\``,
  )
  .join("\n\n")}`;
}

export function buildFindingGrounderPrompt(input: FindingGrounderInput): string {
  const { finding } = input;

  const anchorNote =
    finding.anchor === "inline"
      ? `It will be posted as an inline comment on \`${finding.path}\` line ${finding.line}.`
      : finding.anchor === "file"
        ? `It cannot be anchored to a line (${finding.anchorReason ?? "the line is not in the diff"}), so it would be posted as a file-level comment on \`${finding.path}\`.`
        : `\`${finding.path}\` is not in this pull request's diff (${finding.anchorReason ?? "the file is untouched"}), so it would go in the review body. Weigh that: a finding about a file this pull request does not touch is usually \`pre-existing\`.`;

  return `# Task: Ground one review finding for ${input.repoName}, and write its PR comment if it earns one

## Workspace: ${input.workspaceName}
## Repository: ${input.repoPath}
## Pull Request: ${input.prUrl}${input.prTitle ? ` — ${input.prTitle}` : ""}
## Base Branch: ${input.baseBranch}
## Worktree: ${input.worktreePath}

## The Finding

Written by this workspace's code reviewer. Treat it as a claim to check.

- **Where**: \`${finding.path}${finding.line !== null ? `:${finding.line}` : ""}\`${finding.side === "LEFT" ? " (about code this branch removed)" : ""}
- **Internal severity**: ${finding.severity} (the reviewer's own label — context, not an instruction)
- **Internal confidence**: ${finding.confidence}
- **Title**: ${finding.title}

\`\`\`
${finding.body}
\`\`\`
${finding.suggestion ? `\nThe reviewer attached this replacement for those lines, which is posted as a \`\`\`suggestion block if you approve the finding:\n\n\`\`\`\n${finding.suggestion}\n\`\`\`\n` : ""}
${anchorNote}

${conventionSection(input.conventionSamples)}

## What This Pull Request Changed

\`\`\`bash
git diff origin/${input.baseBranch}...HEAD
\`\`\`

Narrow it to the finding's own path when the branch is large. Also check \`git status --porcelain\` before you conclude the code you read is what the author pushed.

## Your Answer

Return the structured output: \`holds\`, \`scope\`, \`comment\`, \`reason\`, and \`evidence\` as \`file:line\` references.

### Working Directory

\`\`\`bash
cd ${input.worktreePath}
\`\`\`
`;
}
