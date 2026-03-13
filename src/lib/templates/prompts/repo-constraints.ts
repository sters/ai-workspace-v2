/**
 * Prompt template for discovering repository constraints (lint, test, build commands, etc.)
 * and appending them to the workspace README's Requirements section.
 */

export interface RepoConstraintsInput {
  workspaceName: string;
  repoName: string;
  worktreePath: string;
  readmePath: string;
}

export function buildRepoConstraintsPrompt(input: RepoConstraintsInput): string {
  return `# Task: Discover repository constraints for ${input.repoName}

## Workspace: ${input.workspaceName}
## Repository: ${input.repoName}
## Worktree: ${input.worktreePath}
## Workspace README: ${input.readmePath}

## Instructions

You are a specialized agent for discovering repository constraints. Read the repository's documentation and identify any constraints that must be satisfied when making changes (e.g., lint, test, build, type-check commands).

### Execution Steps

1. **Read Repository Documentation**:
   - Read CLAUDE.md, README.md, CONTRIBUTING.md from the repository at ${input.worktreePath}
   - Check for task runners: Makefile, package.json scripts, Taskfile.yml, Justfile, etc.

2. **Identify Constraints**:
   - Lint commands (e.g., \`make lint\`, \`npm run lint\`, \`golangci-lint run\`)
   - Test commands (e.g., \`make test\`, \`npm run test\`, \`go test ./...\`)
   - Build / type-check commands (e.g., \`make build\`, \`tsc --noEmit\`)
   - Any other quality gates documented as required before committing or pushing

3. **Update Workspace README**:
   - Read the workspace README at ${input.readmePath}
   - Append the discovered constraints to the \`## Repository Constraints\` section
   - Use the format below for each repository
   - If no meaningful constraints are found, do NOT add anything
   - Preserve all existing content in the README

### Output Format

Add to the \`## Repository Constraints\` section:

\`\`\`markdown
### ${input.repoName}

- All changes MUST pass the following checks before completion:
  - Lint: \`<command>\`
  - Test: \`<command>\`
  - Build: \`<command>\` (if applicable)
\`\`\`

Only include commands that actually exist in the repository. Do not guess or fabricate commands.

### Working Directory

**IMPORTANT: Your first Bash tool call MUST be \`cd\` alone to change the working directory. Do NOT combine \`cd\` with any other command using \`&&\` or \`;\`.**
\`\`\`bash
cd ${input.worktreePath}
\`\`\`
After that, run commands as separate Bash calls. Do NOT use \`git -C\`.

### Guidelines

1. Only report constraints that are clearly documented or discoverable from the repository
2. Prefer task runner commands (e.g., \`make lint\`) over direct tool invocation
3. Do NOT run the commands — only identify them
4. Do NOT modify any files other than the workspace README
`;
}
