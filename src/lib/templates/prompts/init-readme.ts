/**
 * Prompt template for the merged init operation: analyze task + draft README.
 * Claude analyzes the description and fills in the README template.
 * The analysis result is returned as structured JSON output via --json-schema.
 */

import type { InitAnalyzeAndReadmeInput, InteractionLevel } from "@/types/prompts";

function buildInteractionGuidance(level?: InteractionLevel): string {
  switch (level) {
    case "low":
      return `### User Interaction Policy: LOW (autonomous)

- Make your best judgment for all decisions. Do NOT use AskUserQuestion unless absolutely critical information is missing (e.g., no repositories can be determined at all and the description gives zero hints).
- If the description is ambiguous, choose the most reasonable interpretation and proceed.
- Prefer to fill in reasonable defaults rather than asking.`;
    case "high":
      return `### User Interaction Policy: HIGH (collaborative)

- Use AskUserQuestion proactively to confirm and refine details before finalizing:
  1. If repositories are not explicitly mentioned, ask which repositories to work on.
  2. Confirm the task type and scope with the user (e.g., "I'm interpreting this as a feature task targeting X and Y — is that correct?").
  3. Ask about requirements, constraints, or edge cases that aren't specified but could affect the approach.
  4. Ask about the desired implementation approach if multiple strategies are viable.
  5. Ask about priority and acceptance criteria if not specified.
- The goal is to produce a thorough, well-aligned README that accurately captures the user's intent with no ambiguity.`;
    default: // "mid"
      return `### User Interaction Policy: MID (balanced)

- Use AskUserQuestion when important information is missing or ambiguous:
  1. If no repositories can be determined from the description, ask the user which repositories to work on.
  2. If anything else is unclear that would significantly affect the workspace setup, ask the user.
- Do NOT ask about minor details — use your best judgment for those.`;
  }
}

/**
 * JSON Schema for the analysis result, used with --json-schema to constrain
 * the model's final text response to valid, parseable JSON.
 */
export const INIT_ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    taskType: {
      type: "string",
      enum: ["feature", "bugfix", "research", "review"],
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
  - **"review"**: the goal is to review an existing PR. The description must contain a GitHub PR URL. Use this when the user asks to review, check, or analyze a specific PR.
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

${buildInteractionGuidance(input.interactionLevel)}

### Important Notes

- **Do NOT browse, read, or analyze source code in repositories.** Your sole input is the user's description (and ticket URL if provided). Repository code analysis happens in a later planning phase — not here.
- **Do NOT use file editing tools.** Return the edited README content in the \`readmeContent\` field of your JSON response.
- Keep the template structure, just fill in the placeholder sections
- The README should give clear context for agents that will work on this task later
- Your final text response must be the JSON with all fields including readmeContent
- **If the description contains a GitHub PR URL** (e.g., https://github.com/org/repo/pull/123):
  - Extract the repository from the URL and include it in the \`repositories\` array
  - Include the PR URL in the "Related Resources" section of the README
  - Do NOT omit the PR URL from the README body — the system uses it to resolve branch info automatically
  - **If taskType is "review"** (PR review workspace):
    - **Requirements must describe what the PR is trying to achieve** (the PR's goals and acceptance criteria), NOT what the reviewer should do. A later verification phase checks whether these requirements are satisfied by the code changes. For example:
      - GOOD: "SupportRequest table is correctly defined with proper keys and indexes"
      - GOOD: "gRPC endpoint returns proper error codes for invalid input"
      - BAD: "Review all 24 changed files for correctness"
      - BAD: "Check domain model design and consistency"
    - Use the PR description, linked tickets, and commit messages to extract the PR's original intent and acceptance criteria
    - Review scope / what to check can go in the Context section instead
  - **If the PR is just a reference** for new implementation work, treat it as a normal feature/bugfix task — Requirements should describe the new work to be done, and the PR is just a reference resource
`;
}
