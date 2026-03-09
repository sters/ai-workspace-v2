/**
 * Prompt template for workspace-repo-todo-updater agent.
 * Updates TODO items in a workspace repository.
 */

import type { UpdaterInput } from "@/types/prompts";

export function buildUpdaterPrompt(input: UpdaterInput): string {
  const todoFilePath = `${input.workspacePath}/TODO-${input.repoName}.md`;

  return `# Task: Update TODO items for ${input.repoName}

## Workspace: ${input.workspaceName}
## TODO File: ${todoFilePath}
${input.interactive ? "## Mode: interactive" : ""}

## Update Request

${input.instruction}

## Workspace README

${input.readmeContent}

## Current TODO File (TODO-${input.repoName}.md)

${input.todoContent}

## Instructions

${updaterInstructions(todoFilePath, input.workspacePath, input.worktreePath)}
`;
}

function updaterInstructions(todoFilePath: string, workspacePath: string, worktreePath: string): string {
  const todoFileName = todoFilePath.split("/").pop()!;
  return `You are a specialized agent for updating TODO items in a workspace repository. Your role is to apply user-requested changes to the TODO file.

**Your mission: Apply the requested changes to the TODO file.**

### Execution Steps

1. **Understand Update Request**:
   - Add: New TODO items to add
   - Remove: Existing items to remove (only uncompleted)
   - Modify: Items to change

2. **Analyze Repository** (for abstract Add requests):
   - If the request is abstract, analyze the repository to create specific items
   - If already concrete (includes file paths), proceed directly

3. **Apply Updates**:
   - **ALWAYS delete completed TODO items** (\`[x]\`) to keep file compact
   - Preserve overall structure and formatting style
   - New items MUST follow the structured format

4. **Commit Changes**:
   - Stage and commit TODO file changes using separate commands:
     1. \`git -C ${workspacePath} add ${todoFileName}\`
     2. \`git -C ${workspacePath} commit -m "message"\`

### TODO Item Format (Required)

\`\`\`markdown
- [ ] **[Target]** Action description
  - Target: \`path/to/file\` or "New file"
  - Action: Specific change to make
  - Pattern: (optional) Reference to existing code
  - Verify: (optional) How to verify
\`\`\`

### Working Directory

**IMPORTANT: Before running any commands, first change to the repository directory:**
\`\`\`bash
cd ${worktreePath}
\`\`\`

After \`cd\`, run all repo commands directly (no \`-C\` flags needed).
The TODO file is at \`${todoFilePath}\`. Use Read/Edit with this absolute path.

### Bash Sandbox Restrictions

The following patterns are blocked by the security sandbox:
- \`$(...)\` command substitution in arguments
- \`cd <dir> && git ...\` compound commands
- Use separate \`git -C <dir>\` commands instead of compound commands

### Interactive Mode

If Mode is "interactive", preview changes before applying and ask for user approval.

### Guidelines

1. Auto-compact: always remove completed items
2. Match style: follow existing formatting conventions
3. Be precise: only make requested changes
4. Validate: ensure valid markdown after updates
`;
}
