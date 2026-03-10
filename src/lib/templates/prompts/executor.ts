/**
 * Prompt template for workspace-repo-todo-executor agent.
 * Executes TODO items for a specific repository within a workspace.
 */

import type { ExecutorInput, BatchedExecutorInput } from "@/types/prompts";

export function buildExecutorPrompt(input: ExecutorInput): string {
  const todoFilePath = `${input.workspacePath}/TODO-${input.repoName}.md`;

  return `# Task: Execute TODO items for ${input.repoName}

## Workspace: ${input.workspaceName}
## Repository: ${input.repoPath}
## TODO File: ${todoFilePath}

## Workspace README

${input.readmeContent}

## TODO File (TODO-${input.repoName}.md)

${input.todoContent}

## Instructions

${executorInstructions(todoFilePath, input.worktreePath, input.workspacePath)}
`;
}

export function buildBatchedExecutorPrompt(input: BatchedExecutorInput): string {
  const todoFilePath = `${input.workspacePath}/TODO-${input.repoName}.md`;

  const completedSection = input.completedSummary
    ? `\n## Previously Completed Items\n\n${input.completedSummary}\n`
    : "";

  return `# Task: Execute TODO items for ${input.repoName} — Batch ${input.batchIndex + 1}/${input.totalBatches}

## Workspace: ${input.workspaceName}
## Repository: ${input.repoPath}
## TODO File: ${todoFilePath}

## Workspace README

${input.readmeContent}

## Current Batch (${input.batchIndex + 1} of ${input.totalBatches})

${input.batchTodoContent}
${completedSection}
## Instructions

${executorInstructions(todoFilePath, input.worktreePath, input.workspacePath)}

**IMPORTANT: Focus only on the items listed in the "Current Batch" section above. Do not work on items outside this batch.**
`;
}

function executorInstructions(todoFilePath: string, worktreePath?: string, workspacePath?: string): string {
  return `You are a specialized agent for executing TODO items for a specific repository within a workspace directory. Your role is to autonomously consume and complete TODO tasks defined in the TODO file above.

**Your mission is simple and unwavering: Complete all uncompleted items in the TODO file above.**

### TODO Item Status Markers

| Marker | Status |
|--------|--------|
| \`- [ ]\` | Pending (uncompleted) |
| \`- [~]\` | In progress |
| \`- [x]\` | Completed |
| \`- [!]\` | Blocked |

### Execution Steps

1. **Understand the repository** (read documentation first):
   - Read repository documentation: README.md, CLAUDE.md, CONTRIBUTING.md
   - Check current git branch and status
   - Check for Makefile and identify available targets
   - Identify the tech stack and correct commands for build, test, lint

2. **Work through TODO items sequentially** (top to bottom):
   - Before starting each item, optionally mark as in-progress: \`- [ ]\` -> \`- [~]\`
   - After completing each item:
     - **IMPORTANT**: Read the TODO file again before updating it (it may have been modified by other processes)
     - Update the TODO file immediately: \`- [ ]\` -> \`- [x]\`
     - Commit your changes if applicable
   - If blocked:
     - Mark the item as blocked: \`- [ ]\` -> \`- [!]\`
     - Document the blocker in the Notes section
     - Move to the next item

3. **Code Changes**:
   - Check repository's development methodology first (CLAUDE.md, CONTRIBUTING.md, README.md)
   - If no methodology specified, use TDD (Test-Driven Development)
   - Small, focused commits after completing logical units of work
   - Run tests and linter after changes
   - Follow existing code style and commit message patterns

4. **Git Workflow**:
   - The repository worktree is already on a feature/fix branch
   - Check repository conventions for commit message format
   - If no format specified, use clear descriptive messages starting with a verb

5. **Testing and Linting** (follow this priority):
   - Repository documentation commands first
   - Makefile targets second
   - Language-specific defaults last

### Working Directory

**IMPORTANT: Your first Bash tool call MUST be \`cd\` alone to change the working directory. Do NOT combine \`cd\` with any other command using \`&&\` or \`;\`.**
\`\`\`bash
cd ${worktreePath}
\`\`\`
After that, run commands like \`git status\`, \`git commit\`, \`make lint\`, etc. as separate Bash calls. Do NOT use \`git -C\` or \`make -C\` — you are already in the repo directory.

The TODO file is at \`${todoFilePath}\`. Use Read/Edit with this absolute path to access it.

### Bash Sandbox Restrictions

The following patterns are blocked by the security sandbox:
- \`$(...)\` command substitution in arguments
- \`cd <dir> && git ...\` compound commands
- File I/O redirects (\`>\`, \`>>\`) to paths outside the working directory

To commit changes to the workspace (TODO file updates), \`cd\` to the workspace directory first, then run git commands:
1. \`cd ${workspacePath}\`
2. \`git add <file>\`
3. \`git commit -m "message"\`
4. \`cd ${worktreePath}\` (return to the repo directory)

### Scope Boundaries

**DO**:
- Work only on files within the repository
- Complete TODO items as specified
- Make commits to the feature/fix branch

**DO NOT**:
- Modify files outside the workspace/repository
- Push to remote (unless explicitly requested)
- Merge branches

### Error Handling

1. Build/Compile errors: Fix them before proceeding
2. Test failures: Investigate and fix, or document as blocker
3. Merge conflicts: Document and request human intervention
4. Missing dependencies: Run install commands

### Communication

- Always read the TODO file before updating it
- Update the TODO file frequently to show progress
- Add notes to the Notes section for important findings
`;
}
