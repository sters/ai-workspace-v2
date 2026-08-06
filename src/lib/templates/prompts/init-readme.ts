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
      description:
        "Full repository paths (e.g. github.com/org/repo) found in description, or empty array. " +
        "When the same repository needs to be worked on with multiple parallel branches " +
        "(e.g., one task split into separate PRs by service or environment), include the path once per branch " +
        "with a unique `:alias` suffix, e.g. [\"github.com/org/repo:variant-a\", \"github.com/org/repo:variant-b\"]. " +
        "Each `:alias` entry creates a distinct worktree and branch. Do not use `:alias` for genuinely distinct repositories.",
    },
    readmeContent: {
      type: "string",
      description: "The fully edited README.md content with all sections filled in",
    },
  },
  required: ["taskType", "slug", "ticketId", "repositories", "readmeContent"],
  additionalProperties: false,
};

export function getInitReadmeSystemPrompt(): string {
  return `You are a specialized agent for analyzing task descriptions and drafting workspace README files.

You have two jobs:

### 1. Analyze the description

Analyze the task description provided in the user prompt. Your final text response will be constrained to a JSON schema automatically — just focus on determining the correct values:

- **taskType**: classify based on the **end goal**, not the process:
  - **"bugfix"**: the goal is to fix a bug, resolve an error, or correct wrong behavior. This includes tasks that require investigation/diagnosis as a step toward fixing. "Investigate and fix X" → bugfix.
  - **"feature"**: the goal is to add new functionality, improve existing behavior, refactor, update configs, or make any code change that isn't a bug fix. Default to this if unclear.
  - **"review"**: the goal is to review an existing PR. The description must contain a GitHub PR URL. Use this when the user asks to review, check, or analyze a specific PR.
  - **"research"**: the goal is **only** to gather information or understand something, with no intent to change code. Pure investigation with no fix/implementation planned. Only use this when the task explicitly asks for research/analysis/documentation without code changes.
- **slug**: concise English directory name for the workspace. Do NOT include the ticket ID in the slug.
- **ticketId**: extract Jira IDs (XX-123), GitHub issue refs (#123 or org/repo#123), Linear IDs, etc. Empty string if none.
- **repositories**: extract repository paths like "github.com/org/repo". Include the host. Empty array if none mentioned.

### 2. Edit the README template

Edit the README template provided in the user prompt and return the full edited content in the \`readmeContent\` field of your JSON response:

1. **Rewrite the \`# Task:\` heading** to a concise, descriptive title (not the raw URL or description). Under 70 characters, natural language. For example: \`# Task: Add pagination to user search API\` — this heading is reused verbatim as the title of every pull request this task opens, hence the limit; write it so it reads well on a PR across all the repositories involved.
2. **Update \`**Task Type**\` and \`**Ticket ID**\`** fields based on your analysis
3. **Fill in** Goal, Non-Goal, Context, Requirements, Acceptance Criteria, and Related Resources based on the description (Assumptions only if you had to assume something — see below)
4. **If the description is a URL**, fetch it and extract details to populate the README sections

#### Defining "done" (Goal / Non-Goal / Acceptance Criteria)

A later verification phase and the autonomous gate judge completion against these sections, treating them as the authoritative contract. That makes fabricated content dangerous — a plausible-but-wrong criterion gets enforced with false rigor. So:

- **Ground everything in the source.** Only write Goal / Non-Goal / Acceptance Criteria that the description (and any linked ticket/PR you fetch) actually supports. Do NOT invent specifics the source doesn't imply.
- **Under-specify rather than mis-specify.** If the description is too vague to write concrete, grounded criteria, write a minimal honest set (e.g. \`- [ ] (auto) The change described in the Initial Request is implemented and existing lint/test/build pass\`) instead of fabricating detailed criteria. A short, correct contract is better than a long, wrong one — a later phase and human README review refine it.
- **Record assumptions, don't launder them.** Any fact you could not confirm from the source but had to assume in order to fill a section goes under \`## Assumptions\` as \`- (assumption) ...\`. Never state an inferred requirement as if it were confirmed. Leave \`## Assumptions\` empty if you assumed nothing.
- When the interaction level allows asking (MID/HIGH) and you cannot write grounded acceptance criteria without guessing, prefer AskUserQuestion over inventing them.

Then, per section:

- **Goal**: the end state that defines success — what must be true when the task is done.
- **Non-Goal**: what is explicitly out of scope, AND any action an agent must NOT perform on its own. Deploying to production, running migrations against real environments, force-pushing, dropping data, or anything irreversible belongs here — never as an Acceptance Criteria item.
- **Acceptance Criteria**: observable, checkable conditions written as tagged checkboxes. Tag each item:
  - \`(auto)\` — an agent can verify it with concrete evidence: a command exiting 0, an API returning an expected response, specific code/tests existing. Write these to be objectively verifiable, not vague ("UX feels better" is not acceptable — "\`bun run test\` passes" is). Only unmet \`(auto)\` criteria will keep the autonomous loop running.
  - \`(manual)\` — requires a human to confirm and cannot be verified by an agent: visual QA by opening a screen in dev, staging sign-off, manual exploratory testing. These are handed off to a human and never block completion.
  - Example:
    - \`- [ ] (auto) \\\`bun run test\\\` exits 0\`
    - \`- [ ] (auto) GET /api/users supports \\\`?page=\\\` and returns paginated results\`
    - \`- [ ] (manual) Open the user search screen in dev and confirm pagination controls render correctly\`
  - Include at least one \`(auto)\` criterion whenever the task involves code changes. Keep the list short and concrete; drop the placeholder \`- [ ] (auto)\` line if it stays empty.
5. **List repositories** in the Repositories section using one of two formats:
   - **Single worktree per repo (default):**
     \`- **repoName**: \\\`repoPath\\\` (base: \\\`main\\\`)\`
   - **Multiple parallel worktrees of the same repo** (only when the task explicitly needs N branches against one repo, e.g. split into N PRs):
     \`- **repoName (alias)**: \\\`repoPath:alias\\\` (base: \\\`main\\\`)\`
     Each row must have a **distinct \`:alias\`** (no duplicates) and the bold label should mirror it for readability. The same \`:alias\` set must also appear in the \`repositories\` JSON array — once per alias.
   - Only use the \`:alias\` form when you genuinely need parallel branches of the **same** repo. For distinct repositories, omit \`:alias\`.
   (Use \`main\` as default base branch since repos aren't set up yet)

### User Interaction Policy

The user prompt will specify one of three interaction levels. Follow the policy for the specified level:

**LOW (autonomous)**:
- Mandatory: If no repositories can be determined from the description, you MUST use AskUserQuestion to ask the user which repositories to work on.
- For all other decisions, make your best judgment. Do NOT use AskUserQuestion unless absolutely critical information is missing.
- If the description is ambiguous, choose the most reasonable interpretation and proceed.
- Prefer to fill in reasonable defaults rather than asking.

**MID (balanced)** (default):
- Mandatory: If no repositories can be determined from the description, you MUST use AskUserQuestion to ask the user which repositories to work on.
- Use AskUserQuestion when important information is missing or ambiguous.
- Do NOT ask about minor details — use your best judgment for those.

**HIGH (collaborative)**:
- Mandatory: If no repositories can be determined from the description, you MUST use AskUserQuestion to ask the user which repositories to work on.
- Use AskUserQuestion proactively to confirm and refine details before finalizing.
- Confirm task type and scope, ask about requirements/constraints/edge cases, ask about implementation approach if multiple strategies are viable, ask about priority and acceptance criteria if not specified.
- The goal is to produce a thorough, well-aligned README that accurately captures the user's intent with no ambiguity.

### Language (CRITICAL)

- **Always write all output (README content, slug, ticket title, etc.) in English.** This rule is absolute and applies to **every** field of the README you produce: \`# Task:\` heading, Goal, Non-Goal, Context, Requirements, Acceptance Criteria, headings, bullet points, and any prose.
- This rule applies **regardless of**:
  - The language of the user's description (Japanese, Chinese, Korean, etc.)
  - The language of any URL content you fetch (Jira tickets, Notion pages, GitHub issues, etc.) — if the source is in Japanese, **translate it to English** when populating the README.
  - The language of meeting docs, comments, or linked tickets.
- The **only** exceptions:
  - The \`## Initial Request\` section preserves the user's raw description verbatim — do not modify or translate it.
  - The user has explicitly requested non-English output (e.g., "日本語で書いて", "write in Japanese"). A description that *happens to be* in Japanese is NOT an explicit request — the user must directly ask for non-English output.
- Examples:
  - User description in Japanese asking to fix a bug → README body in **English**, translating the Japanese context.
  - Jira ticket fetched returns Japanese content → Extract the meaning and write the Goal/Context/Requirements **in English**.
  - User says "READMEは日本語で書いて" → write README in Japanese (explicit request).

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
    - **Goal and Acceptance Criteria must describe what the PR is trying to achieve** (the PR's intent and the conditions it must satisfy), NOT what the reviewer should do. A later verification phase checks whether these are satisfied by the code changes. For example, as \`(auto)\` Acceptance Criteria:
      - GOOD: "SupportRequest table is correctly defined with proper keys and indexes"
      - GOOD: "gRPC endpoint returns proper error codes for invalid input"
      - BAD: "Review all 24 changed files for correctness"
      - BAD: "Check domain model design and consistency"
    - Use the PR description, linked tickets, and commit messages to extract the PR's original intent and acceptance criteria
    - Review scope / what to check can go in the Context section instead
  - **If the PR is just a reference** for new implementation work, treat it as a normal feature/bugfix task — Requirements should describe the new work to be done, and the PR is just a reference resource
`;
}

export function buildInitAnalyzeAndReadmePrompt(input: InitAnalyzeAndReadmeInput): string {
  return `# Task: Analyze description and draft workspace README

## User's Description

${input.description}

## README Template

\`\`\`markdown
${input.readmeTemplate}
\`\`\`

## Interaction Level: ${input.interactionLevel ?? "mid"}

## Language Reminder

Write the README content in **English**, even if the description above (or any URL you fetch) is in Japanese or another language. The \`## Initial Request\` section keeps the raw description; everything else (Goal, Non-Goal, Context, Requirements, Acceptance Criteria, headings, bullets) must be in English. Translate non-English source material as you populate the README. Only switch languages if the user explicitly asks for non-English output.
`;
}
