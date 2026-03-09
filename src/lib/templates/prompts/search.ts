/**
 * Prompt template for deep search across workspaces.
 * Uses Claude to explore workspace directories and find relevant information.
 */

export function buildSearchPrompt(query: string, workspacePath: string): string {
  return `# Task: Search across workspaces

## Workspace Directory
${workspacePath}

## Search Query
${query}

## Instructions

Search through all workspace directories in the workspace directory above. Each workspace contains:
- README.md — workspace overview, goals, and status
- TODO-*.md — task lists with progress
- artifacts/reviews/ — review session summaries

For the given search query, find all relevant workspaces and information.
Read files, grep for keywords, and explore directories as needed to find matches.

Return results as JSON matching the schema provided. For each matching workspace:
- "workspaceName": the directory name of the workspace
- "title": the workspace title from README.md (the text after "# Task: ")
- "excerpts": array of relevant text excerpts or summaries explaining why this workspace matches the query

Only include workspaces that are relevant to the search query. Be thorough but precise.`;
}

export const DEEP_SEARCH_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          workspaceName: { type: "string" },
          title: { type: "string" },
          excerpts: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["workspaceName", "title", "excerpts"],
      },
    },
  },
  required: ["results"],
} as const;
