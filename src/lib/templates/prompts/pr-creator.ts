/**
 * Prompt template for workspace-repo-create-or-update-pr agent.
 * Creates or updates a pull request for a repository.
 */

import type { PRCreatorInput } from "@/types/prompts";

export function buildPRCreatorPrompt(input: PRCreatorInput): string {
  const existingPRSection = input.existingPR
    ? `## Existing PR

**URL**: ${input.existingPR.url}
**Title**: ${input.existingPR.title}

**Body**:
${input.existingPR.body}
`
    : "";

  // When an existing PR exists, its body serves as the template — no need for the repo template file.
  const prTemplateSection =
    !input.existingPR && input.prTemplate
      ? `## PR Template

The following is the repository's PR template. You MUST use this template as the PR body structure and fill in each section based on the changes above. Do NOT search for a PR template file — it is already provided here.

\`\`\`markdown
${input.prTemplate}
\`\`\`
`
      : "";

  return `# Task: ${input.existingPR ? "Update" : "Create"} PR for ${input.repoName}

## Workspace: ${input.workspaceName}
## Repository: ${input.repoPath}
## Base Branch: ${input.baseBranch}
## Worktree: ${input.worktreePath}
## Draft: ${input.draft}

## Workspace README

${input.readmeContent}

## Repository Changes

${input.repoChanges}

${existingPRSection}
${prTemplateSection}
## Instructions

${prCreatorInstructions(input.worktreePath)}
`;
}

function prCreatorInstructions(worktreePath: string): string {
  return `You are a specialized agent for creating or updating a pull request for a repository.

**Your mission: Create or update a pull request based on the changes and context above.**

### Git History Rules

- **Do NOT rebase or amend commits** — always create new commits. Keep the commit history as-is.
- **Do NOT force-push** — if the remote branch has new commits, pull and merge them before pushing.
- Unless the user explicitly instructs otherwise, never rewrite git history.

### Commit Uncommitted Changes First

Before pushing or creating a PR, **always check for uncommitted changes** — the user may have edited files directly.

1. Run \`git status\` to check for uncommitted or untracked files
2. If there are any changes:
   - Stage them: \`git add -A\`
   - Commit with a descriptive message summarizing the changes: \`git commit -m "..."\`
3. If the working tree is clean, proceed to the next step

### If Creating a New PR

1. **Compose PR Content**:
   - Title: concise, under 70 characters
   - If a PR Template is provided above, fill in each section of the template with the relevant change information. Do NOT search for a template file.
   - If no PR Template is provided, use a standard format
   - Include ticket URLs in "Related issues" section

3. **Push and Create**:
   - Push the branch to remote: \`git push -u origin <branch>\`
   - If the push is rejected because the remote has new commits, run \`git pull --no-rebase\` to merge, then push again. Do NOT force-push.
   - Create PR using \`gh pr create\`
   - Use \`--draft\` flag if Draft is true

### If Updating an Existing PR

1. **Use the Existing PR Body as the base** — preserve its structure, formatting, and any content the user has manually added
2. **Update only the sections that describe what this PR is** (summary, changed files, implementation details) to reflect the current full set of changes. The description should explain "what this PR is", not log each update or review feedback.
3. **Do NOT add** update history, incremental change logs, or review feedback sections
4. **Keep everything else unchanged** — do NOT remove or rewrite user-added notes, QA results, manual annotations, or any human-added content
5. **Update the title** if the scope of changes has significantly shifted
6. **Push** latest changes: \`git push\` — if rejected, run \`git pull --no-rebase\` to merge remote changes first. Do NOT force-push.
7. **Update** PR using \`gh pr edit\`

### Working Directory

**IMPORTANT: Your first Bash tool call MUST be \`cd\` alone to change the working directory. Do NOT combine \`cd\` with any other command using \`&&\` or \`;\`.**
\`\`\`bash
cd ${worktreePath}
\`\`\`
After that, run commands like \`git push\`, \`gh pr create\`, etc. as separate Bash calls. Do NOT use \`git -C\` — you are already in the repo directory.
The workspace directory is also available via \`--add-dir\` for reading workspace artifacts.

### Guidelines

- Always use draft mode unless Draft is explicitly false
- Follow repository's PR template exactly if one exists
- Keep title concise (under 70 characters)
- Include all commits in summary, not just the latest
- Always include full ticket URLs (not just IDs)
`;
}
