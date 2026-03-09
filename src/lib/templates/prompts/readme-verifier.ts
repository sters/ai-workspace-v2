/**
 * Prompt template for workspace-repo-readme-verifier agent.
 * Verifies that README requirements have been satisfied by the implementation.
 */

import type { ReadmeVerifierInput } from "@/types/prompts";

export function buildReadmeVerifierPrompt(input: ReadmeVerifierInput): string {
  return `# Task: Verify README requirements for ${input.repoName}

## Workspace: ${input.workspaceName}
## Repository: ${input.repoPath}
## Base Branch: ${input.baseBranch}
## Review Timestamp: ${input.reviewTimestamp}
## Worktree: ${input.worktreePath}
${input.ticketId ? `## Ticket ID: ${input.ticketId}` : ""}

## README Content

${input.readmeContent}

## Repository Changes

${input.repoChanges}

## Verification Report Template

Write the verification report to: ${input.verifyFilePath}

Read the verification report template file at: workspace/${input.workspaceName}/readme-verification-report-template.md
Use it as the base structure for the report.

## Instructions

${readmeVerifierInstructions(input.worktreePath, input.baseBranch, input.ticketId)}
`;
}

function readmeVerifierInstructions(worktreePath: string, baseBranch: string, ticketId: string): string {
  const ticketSection = ticketId
    ? `
### Ticket Requirements

A ticket ID has been provided: ${ticketId}

- If it looks like a GitHub Issue (e.g. \`owner/repo#123\` or a numeric ID), run:
  \`\`\`bash
  gh issue view ${ticketId}
  \`\`\`
- If it looks like a GitHub PR URL or reference, run:
  \`\`\`bash
  gh pr view ${ticketId}
  \`\`\`
- Extract any additional requirements from the ticket and include them in the verification.
`
    : "";

  return `You are a specialized agent for verifying that README requirements have been fulfilled by the implementation. Your role is to compare the README's stated goals, scope, and expected outcomes against actual code changes.

**IMPORTANT: Scope Limitation**
- You ONLY verify whether README requirements have been satisfied
- You do NOT review code quality, style, or implementation details
- Focus on whether the stated goals and expected outcomes are met

### Execution Steps

1. **Extract Requirements** from the README content above:
   - Purpose / objectives
   - Scope (what should be changed)
   - Expected outcomes / deliverables
   - Any acceptance criteria
${ticketSection}
2. **Get Changed Files**:
   \`\`\`bash
   git diff --name-only origin/${baseBranch}...HEAD
   \`\`\`

3. **Review Changes**:
   \`\`\`bash
   git diff origin/${baseBranch}...HEAD --stat
   git log origin/${baseBranch}...HEAD --oneline
   \`\`\`

4. **Verify Each Requirement**:
   - Check if the required files were created or modified
   - Verify expected functionality exists (search for patterns, function names, etc.)
   - Classify each requirement as:
     - **SATISFIED**: Requirement is fully met with evidence
     - **PARTIAL**: Requirement is partially met (explain what's missing)
     - **UNSATISFIED**: No evidence the requirement was addressed

5. **Write Verification Report** to the specified file path

### Working Directory

**IMPORTANT: Your first Bash tool call MUST be \`cd\` alone to change the working directory. Do NOT combine \`cd\` with any other command using \`&&\` or \`;\`.**
\`\`\`bash
cd ${worktreePath}
\`\`\`
After that, run commands like \`git diff\`, \`git log\`, etc. as separate Bash calls. Do NOT use \`git -C\` — you are already in the repo directory.

### Guidelines

1. Be thorough but practical — check each stated requirement
2. Provide evidence for each classification (file paths, code snippets, etc.)
3. If a requirement is ambiguous, note the ambiguity and make a best-effort judgment
4. Stay in scope: only verify requirement fulfillment, never comment on code quality
`;
}
