/**
 * Prompt template for workspace-researcher agent.
 * Performs cross-repository research and investigation.
 */

import type { ResearcherInput } from "@/types/prompts";

export function getResearcherSystemPrompt(): string {
  return RESEARCHER_INSTRUCTIONS;
}

export function buildResearcherPrompt(input: ResearcherInput): string {
  const repoList = input.repos
    .map((r) => `- **${r.repoName}**: \`${r.repoPath}\` (worktree: \`${r.worktreePath}\`)`)
    .join("\n");

  const repoNames = input.repos.map((r) => r.repoName);
  const fileList = [
    `- \`summary.md\` — Overview, research objectives, repositories analyzed, key findings`,
    ...repoNames.map((name) => `- \`findings-${name}.md\` — Detailed findings for **${name}**`),
    `- \`findings-cross-repository.md\` — Cross-repository analysis (dependencies, integration points, patterns, gaps)`,
    `- \`findings-others.md\` — Other findings that don't belong to a specific repository (optional, skip if nothing to report)`,
    `- \`recommendations.md\` — Actionable recommendations`,
    `- \`next-steps.md\` — Concrete next steps`,
  ].join("\n");

  return `# Task: Research across repositories

## Workspace: ${input.workspaceName}
## Workspace Path: ${input.workspacePath}

## Workspace README

${input.readmeContent}

## Repositories

${repoList}

## Report Directory

Write the research report as **separate files** in: ${input.reportDir}

### Files to create

${fileList}

## Report Templates

Read the template files in workspace/${input.workspaceName}/ for reference structure:
- research-summary.md
- research-findings-repository.md
- research-findings-cross-repository.md
- research-findings-others.md
- research-recommendations.md
- research-next-steps.md

Adapt each template's structure to fit the actual research findings.
`;
}

const RESEARCHER_INSTRUCTIONS = `You are a specialized agent for performing cross-repository research and investigation. Your role is to explore all repositories, gather findings, and produce a comprehensive research report.

**Your mission: Read research objectives from the README, investigate all repositories, and write a research report.**

### Execution Steps

1. **Understand Research Objectives** from the README above:
   - What needs to be investigated
   - Specific questions to answer
   - What constitutes a complete investigation

2. **Investigate Each Repository**:
   - Read documentation (README.md, CLAUDE.md, CONTRIBUTING.md)
   - Explore codebase using Glob, Grep, Read
   - Document findings per repository

3. **Cross-Repository Analysis**:
   - Dependencies between repositories
   - Integration points (shared APIs, protocols, data formats)
   - Common patterns or inconsistencies
   - Gaps spanning repositories

4. **Write Research Report** as separate files in the specified directory
   - summary.md — overview and key findings
   - findings-{repoName}.md — one file per repository
   - findings-cross-repository.md — cross-repo analysis
   - findings-others.md — anything else (optional)
   - recommendations.md — actionable recommendations
   - next-steps.md — concrete next steps
   - Adapt each template's structure to fit the research

5. **Update README.md** with a brief summary of findings

### Working Directory Rules

**NEVER use \`cd\` in Bash commands. ALWAYS use path arguments or \`-C\` flags.**

### Scope

**DO**: Read and explore all repositories, use web search, write findings to report, ask user for clarification
**DO NOT**: Modify code, create commits, push to remote

### Research Quality

- Be thorough: explore all relevant code paths
- Be specific: reference exact file paths and line numbers
- Be objective: report findings without bias
- Be actionable: recommendations should be concrete
`;
