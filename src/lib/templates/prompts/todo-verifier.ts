/**
 * Prompt template for workspace-repo-todo-verifier agent.
 * Verifies TODO items have been properly completed.
 */

import type { TodoVerifierInput } from "@/types/prompts";

export function buildTodoVerifierPrompt(input: TodoVerifierInput): string {
  return `# Task: Verify TODO completion for ${input.repoName}

## Workspace: ${input.workspaceName}
## Repository: ${input.repoPath}
## Base Branch: ${input.baseBranch}
## Review Timestamp: ${input.reviewTimestamp}
## Worktree: ${input.worktreePath}

## TODO File (TODO-${input.repoName}.md)

${input.todoContent}

## Verification Report Template

Write the verification report to: ${input.verifyFilePath}

Read the verification report template file at: workspace/${input.workspaceName}/verification-report-template.md
Use it as the base structure for the report.

## Instructions

${verifierInstructions(input.worktreePath, input.baseBranch)}
`;
}

function verifierInstructions(worktreePath: string, baseBranch: string): string {
  return `You are a specialized agent for verifying that TODO items have been properly completed. Your role is to compare the TODO file against actual code changes and confirm each item was addressed.

**IMPORTANT: Scope Limitation**
- You ONLY verify whether TODO items have been completed (done or not done)
- You do NOT review code quality, design decisions, or implementation details

### Execution Steps

1. **Parse TODO Items** from the TODO file above:
   - Extract checkbox status, target, expected action, verification criteria

2. **Get Changed Files**:
   \`\`\`bash
   git diff --name-only origin/${baseBranch}...HEAD
   \`\`\`

3. **Verify Each TODO Item**:
   - **Checked items (\`[x]\`)**: Verify target file was modified; mark as VERIFIED, UNVERIFIED, or PARTIAL
   - **Unchecked items (\`[ ]\`)**: Check if work was done anyway; mark as INCOMPLETE, UNMARKED, or SKIPPED

4. **Verification Methods**:
   - File existence / modification checks
   - Content search (Grep for expected patterns)
   - Test file existence checks

5. **Write Verification Report** to the specified file path

### Working Directory

Your working directory is set to the repository worktree (\`${worktreePath}\`).
You can run commands like \`git diff\`, \`git log\`, etc. directly.
The workspace directory is also available via \`--add-dir\` for writing verification reports.

### Guidelines

1. Be thorough but practical
2. Don't block on minor issues
3. Focus on discrepancies: flag items marked done without evidence
4. Stay in scope: only verify completion status, never comment on code quality
`;
}
