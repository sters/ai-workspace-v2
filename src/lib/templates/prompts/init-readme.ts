/**
 * Prompt template for the merged init operation: analyze task + draft README.
 * Claude analyzes the description and fills in the README template.
 * The analysis result is returned as structured JSON output via --json-schema.
 */

import type { InitAnalyzeAndReadmeInput } from "@/types/prompts";

/**
 * JSON Schema for the analysis result, used with --json-schema to constrain
 * the model's final text response to valid, parseable JSON.
 */
export const INIT_ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    taskType: {
      type: "string",
      enum: ["feature", "bugfix", "research"],
    },
    slug: {
      type: "string",
      description: "Short English slug (2-5 lowercase words, hyphen-separated) for the workspace directory name",
    },
    ticketId: {
      type: "string",
      description: "Ticket ID if found (e.g. PROJ-123, #456), or empty string",
    },
    repositories: {
      type: "array",
      items: { type: "string" },
      description: "Full repository paths (e.g. github.com/org/repo) found in description, or empty array",
    },
    readmeContent: {
      type: "string",
      description: "The fully edited README.md content with all sections filled in",
    },
  },
  required: ["taskType", "slug", "ticketId", "repositories", "readmeContent"],
  additionalProperties: false,
};

export function buildInitAnalyzeAndReadmePrompt(input: InitAnalyzeAndReadmeInput): string {
  return `# Task: Analyze description and draft workspace README

## User's Description

${input.description}

## Instructions

You have two jobs:

### 1. Analyze the description

Analyze the task description above. Your final text response will be constrained to a JSON schema automatically — just focus on determining the correct values:

- **taskType**: classify based on the **end goal**, not the process:
  - **"bugfix"**: the goal is to fix a bug, resolve an error, or correct wrong behavior. This includes tasks that require investigation/diagnosis as a step toward fixing. "Investigate and fix X" → bugfix.
  - **"feature"**: the goal is to add new functionality, improve existing behavior, refactor, update configs, or make any code change that isn't a bug fix. Default to this if unclear.
  - **"research"**: the goal is **only** to gather information or understand something, with no intent to change code. Pure investigation with no fix/implementation planned. Only use this when the task explicitly asks for research/analysis/documentation without code changes.
- **slug**: concise English directory name for the workspace. Do NOT include the ticket ID in the slug.
- **ticketId**: extract Jira IDs (XX-123), GitHub issue refs (#123 or org/repo#123), Linear IDs, etc. Empty string if none.
- **repositories**: extract repository paths like "github.com/org/repo". Include the host. Empty array if none mentioned.

### 2. Edit the README template

Here is the README template to fill in:

\`\`\`markdown
${input.readmeTemplate}
\`\`\`

Edit this template and return the full edited content in the \`readmeContent\` field of your JSON response:

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
- **Do NOT use file editing tools.** Return the edited README content in the \`readmeContent\` field of your JSON response.
- Keep the template structure, just fill in the placeholder sections
- The README should give clear context for agents that will work on this task later
- Your final text response must be the JSON with all fields including readmeContent
`;
}
