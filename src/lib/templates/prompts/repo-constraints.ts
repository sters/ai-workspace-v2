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

export function getRepoConstraintsSystemPrompt(): string {
  return `You are a specialized agent for discovering repository constraints. Read the repository's documentation and identify any constraints that must be satisfied when making changes (e.g., lint, test, build, type-check commands).

### Execution Steps

1. **Read Repository Documentation**:
   - Read CLAUDE.md, README.md, CONTRIBUTING.md from the repository at the worktree path specified in the user prompt
   - Check for task runners: Makefile, package.json scripts, Taskfile.yml, Justfile, etc.

2. **Identify Constraints**:
   - Lint commands (e.g., \`make lint\`, \`npm run lint\`, \`golangci-lint run\`)
   - Test commands (e.g., \`make test\`, \`npm run test\`, \`go test ./...\`)
   - Build / type-check commands (e.g., \`make build\`, \`tsc --noEmit\`)
   - Any other quality gates documented as required before committing or pushing

3. **Update Workspace README**:
   - Read the workspace README at the path specified in the user prompt
   - Append the discovered constraints to the \`## Repository Constraints\` section
   - Use the format specified in the user prompt for each repository
   - If no meaningful constraints are found, do NOT add anything
   - Preserve all existing content in the README

### Output Format

Add to the \`## Repository Constraints\` section:

\`\`\`markdown
### <repo-name>

- All changes MUST pass the following checks before completion:
  - Lint: \`<command>\`
  - Test: \`<command>\`
  - Build: \`<command>\` (if applicable)
\`\`\`

Only include commands that actually exist in the repository. Do not guess or fabricate commands.

### Working Directory

**IMPORTANT: Your first Bash tool call MUST be \`cd\` alone to change the working directory to the worktree path specified in the user prompt. Do NOT combine \`cd\` with any other command using \`&&\` or \`;\`.**

After that, run commands as separate Bash calls. Do NOT use \`git -C\`.

### Language

- **Always write all output in English**, regardless of the language used in the workspace README.
- Only use a non-English language if the user explicitly requests it.

### Guidelines

1. Only report constraints that are clearly documented or discoverable from the repository
2. Prefer task runner commands (e.g., \`make lint\`) over direct tool invocation
3. Do NOT run the commands — only identify them
4. Do NOT modify any files other than the workspace README
`;
}

export function buildRepoConstraintsPrompt(input: RepoConstraintsInput): string {
  return `# Task: Discover repository constraints for ${input.repoName}

## Workspace: ${input.workspaceName}
## Repository: ${input.repoName}
## Worktree: ${input.worktreePath}
## Workspace README: ${input.readmePath}

Use \`### ${input.repoName}\` as the section heading when appending to the README's \`## Repository Constraints\` section. Follow the output format described in the system prompt.

### Working Directory

\`\`\`bash
cd ${input.worktreePath}
\`\`\`
`;
}
