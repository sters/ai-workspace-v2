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

### If Creating a New PR

1. **Compose PR Content**:
   - Title: concise, under 70 characters
   - If a PR Template is provided above, fill in each section of the template with the relevant change information. Do NOT search for a template file.
   - If no PR Template is provided, use a standard format
   - Include ticket URLs in "Related issues" section

3. **Push and Create**:
   - Push the branch to remote: \`git push -u origin <branch>\`
   - Create PR using \`gh pr create\`
   - Use \`--draft\` flag if Draft is true

### If Updating an Existing PR

1. **Use the Existing PR Body as the base template** — preserve its structure and formatting
2. **Update only sections that describe code changes** (summary, changed files, implementation details) with the latest "Repository Changes" info above
3. **Keep everything else unchanged** — do NOT remove or rewrite QA results, review notes, manual annotations, or any human-added content
4. **Update the title** if the scope of changes has significantly shifted
5. **Push** latest changes: \`git push\`
6. **Update** PR using \`gh pr edit\`

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
