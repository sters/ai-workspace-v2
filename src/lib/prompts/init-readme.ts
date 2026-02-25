/**
 * Prompt template for the merged init operation: analyze task + draft README.
 * Claude analyzes the description, writes analysis JSON, and fills in the README template.
 */

export interface InitAnalyzeAndReadmeInput {
  description: string;
  analysisPath: string;
  readmePath: string;
}

export function buildInitAnalyzeAndReadmePrompt(input: InitAnalyzeAndReadmeInput): string {
  return `# Task: Analyze description and draft workspace README

## User's Description

${input.description}

## Instructions

You have two jobs:

### 1. Write analysis JSON

Analyze the task description above and write a JSON object to \`${input.analysisPath}\` using the Write tool. No explanation, no markdown fences — just the JSON.

JSON schema:
{
  "taskType": "feature" | "bugfix" | "research" | "investigation",
  "slug": "short-english-slug (2-5 lowercase words, hyphen-separated)",
  "ticketId": "ticket ID if found (e.g. PROJ-123, #456), or empty string",
  "repositories": ["github.com/org/repo", ...] (full paths found in description, or empty array)
}

Rules:
- taskType: infer from context. Default to "feature" if unclear.
- slug: concise English directory name for the workspace. Do NOT include the ticket ID in the slug.
- ticketId: extract Jira IDs (XX-123), GitHub issue refs (#123 or org/repo#123), Linear IDs, etc. Empty string if none.
- repositories: extract repository paths like "github.com/org/repo". Include the host. Empty array if none mentioned.

### 2. Edit the README template

A README template has been written at \`${input.readmePath}\`. Edit it to fill in the workspace details:

1. **Rewrite the \`# Task:\` heading** to a concise, descriptive title (not the raw URL or description). Under 80 characters, natural language. For example: \`# Task: Add pagination to user search API\`
2. **Update \`**Task Type**\` and \`**Ticket ID**\`** fields based on your analysis
3. **Fill in** Objective, Context, Requirements, and Related Resources based on the description
4. **If the description is a URL**, fetch it and extract details to populate the README sections
5. **List repositories** in the Repositories section using the format:
   \`- **repoName**: \\\`repoPath\\\` (base: \\\`main\\\`)\`
   (Use \`main\` as default base branch since repos aren't set up yet)
6. If no repositories can be determined from the description, use AskUserQuestion to ask the user which repositories to work on
7. If anything else is unclear, use AskUserQuestion to ask the user

### Important Notes

- **Do NOT browse, read, or analyze source code in repositories.** Your sole input is the user's description (and ticket URL if provided). Repository code analysis happens in a later planning phase — not here.
- Use the file path \`${input.readmePath}\` for README edits
- Keep the template structure, just fill in the placeholder sections
- The README should give clear context for agents that will work on this task later
- Write the analysis JSON file FIRST, then edit the README
`;
}
