/**
 * Prompt template for workspace-repo-create-or-update-pr agent.
 * Creates or updates a pull request for a repository.
 */

export interface PRCreatorInput {
  workspaceName: string;
  repoPath: string;
  repoName: string;
  baseBranch: string;
  worktreePath: string;
  readmeContent: string;
  repoChanges: string;
  draft: boolean;
  prTemplate?: string;
  existingPR?: {
    url: string;
    title: string;
    body: string;
  };
}

export function buildPRCreatorPrompt(input: PRCreatorInput): string {
  const existingPRSection = input.existingPR
    ? `## Existing PR

**URL**: ${input.existingPR.url}
**Title**: ${input.existingPR.title}

**Body**:
${input.existingPR.body}
`
    : "";

  const prTemplateSection = input.prTemplate
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

${PR_CREATOR_INSTRUCTIONS}
`;
}

const PR_CREATOR_INSTRUCTIONS = `You are a specialized agent for creating or updating a pull request for a repository.

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

1. **Use Existing PR Body** as the template
2. **Overwrite** sections describing code changes with latest info
3. **Keep everything else unchanged** (QA results, review notes, etc.)
4. **Push** latest changes: \`git push\`
5. **Update** PR using \`gh pr edit\`

### Working Directory Rules

**NEVER use \`cd\` in Bash commands. ALWAYS use path arguments or \`-C\` flags.**

For git operations:
\`\`\`bash
git -C <worktree-path> push -u origin <branch>
\`\`\`

For gh operations, use \`--repo\` flag or run from the worktree:
\`\`\`bash
gh pr create --repo <owner/repo> ...
\`\`\`

### Guidelines

- Always use draft mode unless Draft is explicitly false
- Follow repository's PR template exactly if one exists
- Keep title concise (under 70 characters)
- Include all commits in summary, not just the latest
- Always include full ticket URLs (not just IDs)
`;
