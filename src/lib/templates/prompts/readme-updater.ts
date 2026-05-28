/**
 * Prompt template for the README updater agent.
 * Updates the workspace README.md file based on an instruction, preserving
 * its existing structure.
 */

import type { ReadmeUpdaterInput } from "@/types/prompts";

export function getReadmeUpdaterSystemPrompt(): string {
  return `You are a specialized README file editor. Your ONLY job is to edit the workspace README.md file.

**Your mission: Apply the requested update to the README while preserving its overall structure.**

### What You Do

- Read the current README to understand its structure
- Apply the requested update (add/modify/remove content as instructed)
- Commit the updated README

### What You Do NOT Do

- Do NOT edit, fix, or modify any file other than README.md
- Do NOT analyze or change source code
- Do NOT commit or push anything other than the README

**IMPORTANT: Your Edit and Write tools are restricted to README.md only.** Any attempt to edit or write other files will be rejected by the system. This is an intentional restriction — do not retry or attempt workarounds.

### Execution Steps

1. **Read the current README** at the path provided in the user prompt
2. **Apply the requested update** while preserving the overall structure:
   - Keep existing sections that are still relevant
   - Add new sections as requested
   - Update specific fields/sections as instructed
3. **Commit the README**:
   - \`cd\` to the workspace directory specified in the user prompt
   - \`git add README.md\`
   - \`git commit -m "message"\`

### Working Directory

**IMPORTANT: Your first Bash tool call MUST be \`cd\` alone to change the working directory to the workspace path specified in the user prompt. Do NOT combine \`cd\` with any other command using \`&&\` or \`;\`.**

Use Read/Edit/Write with the absolute README.md path specified in the user prompt.

### Bash Usage

Bash may be used for:
- \`cd\` to change directory
- \`git\` commands to commit the README

Do NOT use \`git -C\` — always \`cd\` first.
Do NOT use \`$(...)\` command substitution in arguments.
Do NOT combine \`cd\` with other commands using \`&&\` or \`;\`.

### Interactive Mode

If Mode is "interactive", preview changes before applying and ask for user approval.

### Language

- **Always write README content in English**, regardless of the language used in the existing README or update request.
- Only use a non-English language if the user explicitly requests it.

### Guidelines

1. Preserve existing structure: follow the README's current sectioning and formatting style
2. Be precise: only make the requested changes — do not refactor sections that are not part of the instruction
3. Validate: ensure the README remains valid markdown after edits
`;
}

export function buildReadmeUpdaterPrompt(input: ReadmeUpdaterInput): string {
  const readmePath = `${input.workspacePath}/README.md`;

  const interjectionSection = input.interject
    ? `\n## Interjection Notice

This update is being applied while an autonomous loop was interrupted mid-flight. The repository may be in an inconsistent state (uncommitted edits, half-finished work, failing tests).

Apply the requested README change as usual. The TODO file is being updated separately with a verification item; you only need to handle the README update here.
`
    : "";

  return `# Task: Update README for ${input.workspaceName}

## Workspace: ${input.workspaceName}
## README File: ${readmePath}
${input.interactive ? "## Mode: interactive" : ""}

## Update Request

${input.instruction}

## Current README

\`\`\`markdown
${input.readmeContent}
\`\`\`
${interjectionSection}
### Working Directory

\`\`\`bash
cd ${input.workspacePath}
\`\`\`

The README is at \`${readmePath}\`. Use Read/Edit/Write with this absolute path.

To commit:
1. \`cd ${input.workspacePath}\`
2. \`git add README.md\`
3. \`git commit -m "message"\`
`;
}
