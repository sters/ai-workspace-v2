/**
 * Prompt template for creating TODO items from review findings.
 * Reads review artifacts and generates actionable TODO items.
 */

import type { CreateTodoPlannerInput } from "@/types/prompts";

export function buildCreateTodoFromReviewPrompt(input: CreateTodoPlannerInput): string {
  const userInstruction = input.instruction
    ? `

## User Instruction

The user has provided the following instruction for TODO creation. Focus on creating TODO items that match this instruction rather than covering all review findings:

> ${input.instruction}
`
    : "";

  return `# Task: Create TODO items from review findings for ${input.repoName}

## Workspace: ${input.workspaceName}
## Repository: ${input.repoPath}
## Worktree: ${input.worktreePath}
## Review Directory: ${input.reviewDir}
## Task Type: ${input.taskType}
${userInstruction}
## Workspace README

${input.readmeContent}

## Instructions

You are a specialized agent for creating TODO items based on review findings. Your role is to read review artifacts and generate actionable TODO items that address the issues found during code review.${input.instruction ? " Pay special attention to the user instruction above and prioritize items that match it." : ""}

### Execution Steps

1. **Read Review Artifacts**:
   - Read all REVIEW-*.md files in the review directory for this repository (${input.repoName})
   - Read all VERIFY-*.md files in the review directory for this repository
   - Read SUMMARY.md if it exists in the review directory
   - Focus on files that match this repository name

2. **Read Existing TODO File** (if any):
   - Read workspace/${input.workspaceName}/TODO-${input.repoName}.md if it exists
   - Note any already-completed items (\`[x]\`) to avoid duplicating work that's done
   - Note any pending items (\`[ ]\`) to avoid duplicating existing plans

3. **Read Repository Documentation**:
   - Read CLAUDE.md, README.md from the repository at ${input.worktreePath}
   - Extract build/test/lint commands and coding conventions

4. **Create TODO Items** based on review findings:
   - **Critical issues**: Must be addressed — create high-priority TODO items first
   - **Warnings**: Should be addressed — create medium-priority TODO items
   - **Suggestions**: Nice to have — create lower-priority TODO items
   - Skip any issues that correspond to already-completed TODO items

### Output

Write the TODO file to: workspace/${input.workspaceName}/TODO-${input.repoName}.md

If a TODO file already exists, preserve completed items and add new items for unaddressed review findings.

### Working Directory

**IMPORTANT: Before running any commands, first change to the repository directory:**
\`\`\`bash
cd ${input.worktreePath}
\`\`\`

After \`cd\`, run commands like \`git status\`, \`git diff\`, etc. directly.

### TODO Item Format

Each TODO item MUST follow this structured format:

\`\`\`markdown
- [ ] **[Target]** Action description
  - Target: file path or descriptive target
  - Action: Specific change to make (what to add/modify/remove)
  - Source: Which review finding this addresses (e.g., "REVIEW: critical - security issue in auth.ts")
  - Verify: How to verify the change is correct
\`\`\`

### Guidelines

1. Focus on this repository only
2. Prioritize: critical issues > warnings > suggestions
3. Be actionable: each TODO should be something an executor can act on
4. Include exact file paths mentioned in review findings
5. Include commands: specify exact build/test/lint commands from repository docs
6. Order logically: critical fixes first, then warnings, then suggestions
7. Do not duplicate items that already exist in the TODO file
`;
}
