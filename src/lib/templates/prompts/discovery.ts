/**
 * Prompt template for workspace discovery agent.
 * Analyzes a single workspace's meta + operations to discover new workspace candidates.
 */

import type { DiscoveryInput } from "@/types/prompts";

export const DISCOVERY_SCHEMA = {
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
            description: "Actionable description of the work. Include target repositories and concrete scope.",
          },
        },
        required: ["targetRepository", "title", "description"],
        additionalProperties: false,
      },
      description: "Discovered workspace candidates. Empty array if none found.",
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
};

const MAX_SUMMARY_LENGTH = 800;

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

function formatWorkspace(ws: DiscoveryInput["workspace"]): string {
  const todoSummary = ws.todos.length > 0
    ? ws.todos.map((t) =>
        `  - ${t.repoName}: ${t.completed}/${t.total} done, ${t.pending} pending, ${t.blocked} blocked`,
      ).join("\n")
    : "  (no TODOs)";

  return `- **Name:** ${ws.name}
- **Title:** ${ws.title}
- **Task type:** ${ws.taskType}
- **Progress:** ${ws.progress}%
- **Repositories:** ${ws.repositories.join(", ")}
- **TODOs:**
${todoSummary}

### README

\`\`\`markdown
${truncate(ws.readmeContent, 2000)}
\`\`\``;
}

function formatOperations(ops: DiscoveryInput["operations"]): string {
  if (ops.length === 0) return "(no operations recorded)";

  return ops.map((op, i) => {
    const inputDesc = op.inputs.description ?? op.inputs.instruction ?? "";
    const inputLine = inputDesc ? `\n**Input:** ${truncate(String(inputDesc), 300)}` : "";
    const summary = op.resultSummary
      ? truncate(op.resultSummary, MAX_SUMMARY_LENGTH)
      : "(no summary)";
    return `${i + 1}. **[${op.type}]** ${op.completedAt}${inputLine}
   **Result:** ${summary}`;
  }).join("\n\n");
}

export function getDiscoverySystemPrompt(): string {
  return `Based on the README scope, TODO items, and operation results provided, find items that:

1. **Fell outside scope** — Issues, bugs, or improvements mentioned in operation results that the README explicitly does not cover.
2. **Emerged as side effects** — Technical debt, broken assumptions, or missing infrastructure discovered during execution.
3. **Cross-repo concerns** — Patterns affecting repositories listed here that warrant a dedicated workspace (e.g., shared CI, dependency updates, security fixes).
4. **Blocked or deferred items** — TODO items marked as blocked that belong to a different concern.

Do NOT suggest:
- Anything that fits within this workspace's existing scope or TODOs.
- Work already covered by other existing workspaces listed above.
- Trivial items (typos, formatting, minor style issues).
- Vague ideas without a concrete action.

Each suggestion must have:
- A **targetRepository** — the repository alias/short name where the work should be done.
- A **title** (concise, max 80 chars)
- A **description** that specifies the concrete problem and what the new workspace should accomplish. The description should be detailed enough to use directly as input for \`workspace init\`.`;
}

export function buildDiscoveryPrompt(input: DiscoveryInput): string {
  const otherWs = input.otherWorkspaceNames.length > 0
    ? input.otherWorkspaceNames.join(", ")
    : "(none)";

  return `# Workspace Discovery

Analyze the following workspace and its operation history. Identify work items that are **outside this workspace's scope** but worth pursuing as separate workspaces.

## Target Workspace

${formatWorkspace(input.workspace)}

## Operation History for This Workspace

${formatOperations(input.operations)}

## Other Existing Workspaces (avoid duplicating these)

${otherWs}
`;
}
