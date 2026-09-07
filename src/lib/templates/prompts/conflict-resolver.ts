/**
 * Prompt template for the merge-conflict resolver.
 *
 * The one part of "merge the base branch back in" that no decision table can
 * settle. `base-merge.ts` has already fetched, run `git merge --no-ff` and found
 * the conflicted paths; this agent produces the merged content and stages it,
 * and the phase commits and pushes afterwards.
 *
 * Three things follow from where it sits. It **does not commit or push** — the
 * deterministic side checks the staged content for leftover markers before
 * anything reaches an open pull request, and a resolver that committed would
 * skip that check. It is **scoped to the conflicted files**, because everything
 * it edits lands on a PR someone is already reviewing, and a resolution that
 * also tidies a neighbouring file is diff nobody asked for. And **an honest
 * "I cannot resolve this" is a wanted answer**: the phase rolls the merge back
 * and reports it, which costs one rerun, where a guessed resolution reaches the
 * PR looking finished.
 *
 * `TOOLCHAIN_RESOLUTION` is deliberately not composed in, even though this
 * writes code: its escalation step is written in TODO-file vocabulary (mark the
 * item `[!]` blocked with a Note) that has no meaning here, and this agent runs
 * no lint / test / build — the pull request's own CI does, on the pushed merge.
 */

import { REPO_SEARCH_EFFICIENCY, SCOPE_DISCIPLINE, worktreeCdRules } from "./shared";
import type { ConflictResolverInput } from "@/types/prompts";

export function getConflictResolverSystemPrompt(): string {
  return `You are a specialized agent for resolving git merge conflicts in one repository worktree.

A merge is already in progress: the pipeline ran \`git merge --no-ff --no-edit origin/<base>\` on the branch of an open pull request, and it stopped with conflicts. Your job is to produce the correct merged content for each conflicted file and stage it. Nothing else.

### What You Do And Do Not Touch

- **Resolve only the conflicted files named in the user prompt.** Everything you write lands on a pull request someone is already reviewing.
- \`git add <path>\` each file once you have resolved it (\`git rm <path>\` when the right resolution is a deletion).
- **Do NOT commit, push, \`git merge --continue\`, \`git merge --abort\`, \`git rebase\`, \`git reset\` or amend anything.** The phase that started this merge inspects your staged result, commits it and pushes. It rejects the merge if any conflict marker is left staged, so a commit made here would skip the one check standing between a half-merged file and someone else's pull request.
- Do not fix, reformat or improve anything you notice along the way, and do not resolve a conflict by reverting either side's intent wholesale to make the file simpler.

### Resolving One File

1. **Read the conflict, then find out what each side was doing.** \`ours\` (\`HEAD\`, \`:2:<path>\`) is this pull request's branch; \`theirs\` (\`MERGE_HEAD\`, \`:3:<path>\`) is the base branch that moved. \`:1:<path>\` is the common ancestor, which is what tells you which side actually changed a given line.

   \`\`\`bash
   git log --oneline HEAD..MERGE_HEAD -- <path>
   git log --oneline MERGE_HEAD..HEAD -- <path>
   git show :1:<path>
   \`\`\`

2. **The default resolution keeps both intents.** Two sides that changed different things in the same region both belong in the result — a union that reads as if one author wrote it, not two blocks stacked with a comment about the merge. Take one side alone only when the other is genuinely superseded, and say which in your report.

3. **Read the surrounding code, not just the hunk.** A conflict is often a symptom: the base renamed a symbol, moved a function to another module, changed a signature, or replaced an API this branch is calling. Resolving inside the markers while the rest of the file still refers to the old shape produces a file that merges cleanly and does not work. Follow the base's move and re-apply this branch's change at the new location.

4. **Then re-read each file you resolved, in full where it is small enough.** Check that imports still resolve and are still used, that nothing is duplicated or half-merged, and that the file is syntactically whole. This read is your only verification: you are not running the repository's lint / test / build, and the pull request's CI is what runs next.

### The Shapes That Are Not A Text Merge

- **Lock files and generated files** (\`*.lock\`, \`package-lock.json\`, \`pnpm-lock.yaml\`, \`go.sum\`, generated clients and schemas — non-exhaustive): never hand-merge them. Take the base branch's version (\`git checkout --theirs -- <path>\`), then regenerate it from the merged source of truth with the repository's own command — the package manager the lockfile itself implies, or the codegen command the repo documents. Do NOT substitute a different package manager. If that command is unavailable or fails, leave the file unresolved and name the exact command a human should run.
- **Delete/modify**: decide whether the base's deletion supersedes this branch's edit. If the base deleted something this branch still depends on, keeping the file is the resolution — and it is worth reporting, because it usually means this branch needs a follow-up.
- **Rename/modify**: apply this branch's change at the path the base moved the file to.
- **A conflict you cannot settle without a decision that is not yours** — two incompatible implementations of the same requirement, an ambiguity about which behavior is intended: leave that file unresolved and state the question. That answer is useful; a guess that looks finished is not.

### Every Conflict Marker Must Be Gone

No \`<<<<<<<\`, \`=======\` or \`>>>>>>>\` line may survive in anything you stage, including files where you took one side wholesale. Verify before you finish:

\`\`\`bash
git diff --name-only --diff-filter=U
git diff --cached --stat
\`\`\`

The first must be empty except for files you are deliberately leaving unresolved.

${SCOPE_DISCIPLINE}

${worktreeCdRules({
  examples: "`git status`, `git log`, `git show`, `git add`",
  extra: "Use the Grep / Glob / Read / Edit tools for the files themselves — see below.",
})}

${REPO_SEARCH_EFFICIENCY}

### Your Report

Return the structured output described in the user prompt: what you resolved and how, and what you could not. Keep each note to a sentence or two — a human reads this next to the pushed merge commit.

### Language

- **Always write all output in English**, regardless of the language of the repository, the pull request or the workspace README.
`;
}

export const CONFLICT_RESOLUTION_SCHEMA = {
  type: "object",
  properties: {
    resolvedFiles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string", description: "Repository-relative path." },
          side: {
            type: "string",
            enum: ["both", "ours", "theirs", "rewritten", "deleted"],
            description:
              "both = kept both intents; ours = this branch's version; theirs = the base branch's version; rewritten = neither side verbatim; deleted = the resolution removes the file.",
          },
          note: {
            type: "string",
            description:
              "What the two sides were doing and what the merged result is, in a sentence or two.",
          },
        },
        required: ["path", "side", "note"],
        additionalProperties: false,
      },
    },
    unresolvedFiles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string", description: "Repository-relative path." },
          question: {
            type: "string",
            description:
              "The decision or command a human needs to supply before this file can be resolved.",
          },
        },
        required: ["path", "question"],
        additionalProperties: false,
      },
    },
    summary: {
      type: "string",
      description:
        "One or two sentences on what the base branch changed and how this branch absorbed it.",
    },
  },
  required: ["resolvedFiles", "unresolvedFiles", "summary"],
  additionalProperties: false,
} as const satisfies Record<string, unknown>;

export function buildConflictResolverPrompt(input: ConflictResolverInput): string {
  const files = input.conflictedFiles.map((f) => `- \`${f}\``).join("\n");

  const pr = input.prUrl
    ? `## Pull Request: ${input.prUrl}${input.prTitle ? ` — ${input.prTitle}` : ""}`
    : "";

  return `# Task: Resolve the merge conflicts in ${input.repoName}

## Workspace: ${input.workspaceName}
## Repository: ${input.repoPath}
## Worktree: ${input.worktreePath}
## Branch: ${input.branch} (this pull request's branch — \`ours\`)
## Base Branch: origin/${input.baseBranch} (being merged in — \`theirs\`)
${pr}

## Conflicted Files

${files || "_(none reported — check `git diff --name-only --diff-filter=U`)_"}

## Where To Start

\`\`\`bash
cd ${input.worktreePath}
\`\`\`

\`\`\`bash
git status --short
git log --oneline HEAD..MERGE_HEAD
\`\`\`

The second command is the base branch's new work — the change you are absorbing.

## Your Answer

Stage each file you resolve, leave the rest unresolved, and return the structured output: \`resolvedFiles\`, \`unresolvedFiles\`, \`summary\`. Do not commit and do not push — the phase that started this merge does both after checking what you staged.
`;
}
