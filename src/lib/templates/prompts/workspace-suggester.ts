/**
 * Prompt template for Workspace Suggester agent.
 * Reads the execution transcript of a just-finished operation and surfaces
 * incidental, out-of-scope observations Claude made mid-work — the kind of
 * "by the way, I noticed X" findings that don't show up in final TODO/review
 * output but often deserve to become their own workspace.
 */

import type { WorkspaceSuggesterInput } from "@/types/prompts";

export const WORKSPACE_SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          targetRepository: {
            type: "string",
            description: "Name of the primary target repository for this suggestion. Use the repository alias/short name.",
          },
          title: {
            type: "string",
            description: "Short title for the suggested workspace (max 80 chars).",
          },
          description: {
            type: "string",
            description: "Description of the work to be done, suitable as input for workspace init.",
          },
        },
        required: ["targetRepository", "title", "description"],
        additionalProperties: false,
      },
      description: "List of out-of-scope items that could become new workspaces. Empty array if none found.",
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
};

export function getWorkspaceSuggesterSystemPrompt(): string {
  return `You are a workspace suggester agent. You read the **execution transcript** of a just-finished operation and surface **incidental, out-of-scope observations** that Claude made mid-work — the kind of "by the way, I noticed X" findings that never make it into the final TODO or review output.

### What to look for (in the transcript)

The transcript contains assistant \`[text]\` lines, \`[thinking]\` blocks, and \`[tool:*]\` summaries showing which files Claude read, searched, or edited. Look for:

1. **Side remarks in text/thinking**: Claude said something like "I noticed X but that's unrelated", "this looks problematic but is out of scope", "there's a TODO comment here about Y". These are the primary signal.
2. **Files touched that are tangential to the TODO**: Claude read or grepped files that aren't the main target of the task. If it mentioned anything about them, capture that.
3. **Unrelated issues spotted in passing**: broken tests, dead code, suspicious patterns, TODO/FIXME comments in code Claude happened to read.

### What NOT to suggest

- Items that were the **direct goal** of the current operation — those belong to this workspace, not a new one.
- Final summaries, completion reports, or review conclusions — those are the operation's output, not incidental observations.
- Items already covered by the current workspace's README scope.
- Trivial issues (typos, minor style) that don't warrant a separate workspace.
- Vague or speculative items with no concrete location or action.

### Language

- **Always write all output (titles, descriptions) in English**, regardless of the language used in the workspace README or transcript.
- Only use a non-English language if the user explicitly requests it.

### Output

Respond with a JSON object matching the schema. **Return an empty suggestions array if nothing genuinely incidental was observed** — this is the expected outcome most of the time, do not fabricate suggestions. Each suggestion must include:
- A **targetRepository** — the repository alias/short name where the work should be done.
- A clear, actionable **description** that could be used to initialize a new workspace, including concrete file/function references from the transcript when available.`;
}

export function buildWorkspaceSuggesterPrompt(input: WorkspaceSuggesterInput): string {
  return `# Workspace Suggester: Identify Incidental Out-of-Scope Observations

## Workspace: ${input.workspaceName}

## Workspace README (defines the current scope — anything listed here is IN-scope)

${input.readmeContent}

## Execution Transcript Digest

Below is a digest of what Claude did and said during the just-finished operation. Look through \`[text]\`, \`[thinking]\`, and \`[tool:*]\` entries for side-observations about issues, files, or code unrelated to the workspace scope above.

${input.operationDigest}
`;
}
