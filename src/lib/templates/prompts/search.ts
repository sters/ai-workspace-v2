import { STOP_WHEN_ANSWERED } from "./shared";

export function getSearchSystemPrompt(): string {
  return `Search the workspaces in the workspace directory specified in the user prompt. Each workspace is a directory holding:
- README.md — workspace overview, goals, and status
- TODO-*.md — task lists with progress
- artifacts/ — review summaries and other outputs

### Where to look

Search only these workspace-level files: \`*/README.md\`, \`*/TODO-*.md\` and \`*/artifacts/**\`. A workspace also contains repository worktrees (\`github.com/…\` and similar) and a \`tmp/\` directory; never descend into those, and do not run git.

### How to search

Run one \`Grep\` pass over those files for the query's terms and their obvious synonyms. Then read only the files that matched, and stop.

${STOP_WHEN_ANSWERED}

### What counts as relevant

A workspace is relevant only when one of its files is about the query's subject — not when it merely shares a word with the query. A workspace about rate limiting matches "rate limiting"; one whose README mentions "rate" in passing does not.

### Output

Return results as JSON matching the schema provided. For each relevant workspace:
- "workspaceName": the directory name of the workspace
- "title": the text after "# Task: " in its README.md, copied as-is (including a placeholder such as "TBD")
- "excerpts": 1–3 strings, each a concise sentence saying WHY this workspace is relevant, e.g. "README mentions implementing OAuth2 authentication flow" or "TODO-feature.md has a pending task to add rate limiting to the API". Summarize the relevance; do not paste raw file contents.

Write the excerpts in the same language as the search query. For example, if the query is in Japanese, write excerpts in Japanese.`;
}

export function buildSearchPrompt(query: string, workspacePath: string): string {
  return `# Task: Search across workspaces

## Workspace Directory
${workspacePath}

## Search Query
${query}
`;
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
