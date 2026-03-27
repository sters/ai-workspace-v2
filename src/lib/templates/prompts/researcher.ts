/**
 * Prompt template for workspace-researcher agent.
 * Performs cross-repository research and investigation.
 *
 * The research pipeline runs in 3 phases:
 *   Phase 1 — Findings (N+1 parallel): per-repo + cross-repo
 *   Phase 2 — Recommendations & Next Steps (N+1 parallel): reads findings
 *   Phase 3 — Integration (single): produces summary + others
 */

import type {
  ResearcherInput,
  ResearchFindingsRepoInput,
  ResearchRecommendationsRepoInput,
  ResearchRecommendationsCrossInput,
  ResearchIntegrationInput,
} from "@/types/prompts";

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

Read the template files in workspace/${input.workspaceName}/templates/ for reference structure:
- research-summary.md
- research-findings-repository.md
- research-findings-cross-repository.md
- research-findings-others.md
- research-recommendations.md
- research-next-steps.md

Adapt each template's structure to fit the actual research findings.
`;
}

// ---------------------------------------------------------------------------
// Phase 1 — Findings (user prompts: dynamic data only)
// ---------------------------------------------------------------------------

/** Build prompt for a per-repo findings agent (Phase 1). */
export function buildResearchFindingsRepoPrompt(input: ResearchFindingsRepoInput): string {
  const { repo } = input;
  return `## Workspace: ${input.workspaceName}
## Workspace Path: ${input.workspacePath}

## Workspace README

${input.readmeContent}

## Target Repository

- **${repo.repoName}**: \`${repo.repoPath}\` (worktree: \`${repo.worktreePath}\`)

## Output File

\`${input.reportDir}/findings-${repo.repoName}.md\`

## Template

\`${input.workspacePath}/templates/research-findings-repository.md\`
`;
}

/** Build prompt for the cross-repo findings agent (Phase 1). */
export function buildResearchFindingsCrossRepoPrompt(input: ResearcherInput): string {
  const repoList = input.repos
    .map((r) => `- **${r.repoName}**: \`${r.repoPath}\` (worktree: \`${r.worktreePath}\`)`)
    .join("\n");

  return `## Workspace: ${input.workspaceName}
## Workspace Path: ${input.workspacePath}

## Workspace README

${input.readmeContent}

## Repositories

${repoList}

## Output File

\`${input.reportDir}/findings-cross-repository.md\`

## Template

\`${input.workspacePath}/templates/research-findings-cross-repository.md\`
`;
}

// ---------------------------------------------------------------------------
// Phase 2 — Recommendations & Next Steps (user prompts: dynamic data only)
// ---------------------------------------------------------------------------

/** Build prompt for a per-repo recommendations agent (Phase 2). */
export function buildResearchRecommendationsRepoPrompt(input: ResearchRecommendationsRepoInput): string {
  const { repo } = input;
  return `## Workspace: ${input.workspaceName}
## Workspace Path: ${input.workspacePath}

## Workspace README

${input.readmeContent}

## Target Repository

- **${repo.repoName}**: \`${repo.repoPath}\` (worktree: \`${repo.worktreePath}\`)

## Findings — ${repo.repoName}

${input.findingsContent}

## Cross-Repository Findings

${input.crossRepoFindingsContent}

## Output Files

1. \`${input.reportDir}/recommendations-${repo.repoName}.md\`
2. \`${input.reportDir}/next-steps-${repo.repoName}.md\`

## Templates

- \`${input.workspacePath}/templates/research-recommendations-repository.md\`
- \`${input.workspacePath}/templates/research-next-steps-repository.md\`
`;
}

/** Build prompt for the cross-repo recommendations agent (Phase 2). */
export function buildResearchRecommendationsCrossRepoPrompt(input: ResearchRecommendationsCrossInput): string {
  const repoList = input.repos
    .map((r) => `- **${r.repoName}**: \`${r.repoPath}\``)
    .join("\n");

  const findingsSections = input.allFindings
    .map((f) => `### ${f.name}\n\n${f.content}`)
    .join("\n\n---\n\n");

  return `## Workspace: ${input.workspaceName}
## Workspace Path: ${input.workspacePath}

## Workspace README

${input.readmeContent}

## Repositories

${repoList}

## All Findings

${findingsSections}

## Output Files

1. \`${input.reportDir}/recommendations-cross-repository.md\`
2. \`${input.reportDir}/next-steps-cross-repository.md\`

## Templates

- \`${input.workspacePath}/templates/research-recommendations.md\`
- \`${input.workspacePath}/templates/research-next-steps.md\`
`;
}

// ---------------------------------------------------------------------------
// Phase 3 — Integration (user prompt: dynamic data only)
// ---------------------------------------------------------------------------

/** Build prompt for the integration / summary agent (Phase 3). */
export function buildResearchIntegrationPrompt(input: ResearchIntegrationInput): string {
  const fileSections = input.allFiles
    .map((f) => `### ${f.name}\n\n${f.content}`)
    .join("\n\n---\n\n");

  return `## Workspace: ${input.workspaceName}
## Workspace Path: ${input.workspacePath}

## Workspace README

${input.readmeContent}

## Research Files (produced by prior phases)

${fileSections}

## Output Directory

\`${input.reportDir}/\`

## Workspace README Path

\`${input.workspacePath}/README.md\`

## Templates

- \`${input.workspacePath}/templates/research-summary.md\`
- \`${input.workspacePath}/templates/research-findings-others.md\`
`;
}

// ---------------------------------------------------------------------------
// Shared rules embedded in all research system prompts
// ---------------------------------------------------------------------------

const RESEARCH_SHARED_RULES = `### Working Directory Rules

**NEVER use \`cd\` in Bash commands. ALWAYS use path arguments or \`-C\` flags.**

### Scope

**DO**: Read and explore repositories, use web search, write output to the report directory, ask user for clarification
**DO NOT**: Modify source code, create commits, push to remote

### Research Quality

- Be thorough: explore all relevant code paths
- Be specific: reference exact file paths and line numbers
- Be objective: report findings without bias
- Be actionable: recommendations should be concrete
`;

// ---------------------------------------------------------------------------
// Phase-specific system prompts
// ---------------------------------------------------------------------------

const RESEARCH_FINDINGS_REPO_INSTRUCTIONS = `You are a specialized research agent focused on investigating a **single repository**. Your role is to deeply explore the assigned repository and document your findings.

**Your mission**: Investigate the target repository according to the research objectives and write a detailed findings report.

### Execution Steps

1. **Understand Research Objectives** from the Workspace README
2. **Investigate the Repository**:
   - Read documentation (README.md, CLAUDE.md, CONTRIBUTING.md)
   - Explore codebase using Glob, Grep, Read
   - Document: structure, relevant code, issues, observations
3. **Write Findings** to the output file specified in the user prompt
   - Read the template file for the expected structure
   - Adapt it to fit the actual findings

### Scope

Focus **only** on the target repository listed in the user prompt. Do NOT investigate other repositories.

### Output Format

Write a single markdown file containing:
- Overview of the repository
- Structure and key components
- Relevant code (with file paths and line numbers)
- Issues and observations

${RESEARCH_SHARED_RULES}`;

const RESEARCH_FINDINGS_CROSS_REPO_INSTRUCTIONS = `You are a specialized research agent focused on **cross-repository analysis**. Your role is to explore relationships and interactions between all repositories.

**Your mission**: Analyze cross-repository relationships and write a cross-repository findings report.

### Execution Steps

1. **Understand Research Objectives** from the Workspace README
2. **Analyze Cross-Repository Relationships**:
   - Dependencies between repositories
   - Integration points (shared APIs, protocols, data formats)
   - Common patterns or inconsistencies
   - Gaps spanning multiple repositories
3. **Write Findings** to the output file specified in the user prompt
   - Read the template file for the expected structure
   - Adapt it to fit the actual findings

### Scope

Focus on **relationships and interactions** between repositories, not deep per-repo analysis.

### Output Format

Write a single markdown file containing:
- Dependencies between repositories
- Integration points
- Common patterns
- Gaps

${RESEARCH_SHARED_RULES}`;

const RESEARCH_RECOMMENDATIONS_INSTRUCTIONS = `You are a specialized research agent focused on producing **recommendations and next steps**. You receive findings from a prior research phase and translate them into actionable guidance.

**Your mission**: Based on the provided findings, write prioritized recommendations and concrete next steps.

### Execution Steps

1. **Review Findings** provided in the user prompt (repository-specific findings and cross-repository findings)
2. **Write Recommendations** to the first output file:
   - Prioritize: high / medium / low
   - Make each recommendation actionable and specific
   - Consider cross-repository context
3. **Write Next Steps** to the second output file:
   - Concrete actions with clear targets
   - Categorize: immediate / short-term / long-term
4. Read the template files for the expected structure and adapt

### Output Format

Write **two** markdown files (paths specified in the user prompt):
1. **recommendations** — Prioritized, actionable recommendations
2. **next-steps** — Concrete next steps with timeframes

${RESEARCH_SHARED_RULES}`;

const RESEARCH_INTEGRATION_INSTRUCTIONS = `You are a specialized research agent focused on **synthesizing and integrating** research outputs from multiple agents. You receive all findings, recommendations, and next steps, and produce a cohesive summary.

**Your mission**: Read all research files and produce a unified summary that highlights the most important insights.

### Execution Steps

1. **Read All Research Files** provided in the user prompt
2. **Write summary.md** to the output directory:
   - Research objectives (from README)
   - Repositories analyzed (table format)
   - Key findings (brief summary across all repos)
   - Top recommendations
   - Priority next steps
3. **Write findings-others.md** (optional) to the output directory:
   - Findings that don't belong to any specific repository or the cross-repository analysis
   - Skip this file if there is nothing to report
4. **Update the workspace README.md** (path in user prompt) with a brief summary of findings
5. Read the template files for the expected structure and adapt

### Guidelines

- Do NOT duplicate content — summarize and reference the detailed files
- Highlight the most important findings and recommendations
- Keep the summary concise but comprehensive

${RESEARCH_SHARED_RULES}`;

// ---------------------------------------------------------------------------
// Legacy monolithic system prompt (kept for backward compatibility)
// ---------------------------------------------------------------------------

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

${RESEARCH_SHARED_RULES}`;

// ---------------------------------------------------------------------------
// System prompt getters
// ---------------------------------------------------------------------------

/** System prompt for per-repo findings agents (Phase 1). */
export function getResearchFindingsRepoSystemPrompt(): string {
  return RESEARCH_FINDINGS_REPO_INSTRUCTIONS;
}

/** System prompt for cross-repo findings agent (Phase 1). */
export function getResearchFindingsCrossRepoSystemPrompt(): string {
  return RESEARCH_FINDINGS_CROSS_REPO_INSTRUCTIONS;
}

/** System prompt for recommendations & next-steps agents (Phase 2). */
export function getResearchRecommendationsSystemPrompt(): string {
  return RESEARCH_RECOMMENDATIONS_INSTRUCTIONS;
}

/** System prompt for integration / summary agent (Phase 3). */
export function getResearchIntegrationSystemPrompt(): string {
  return RESEARCH_INTEGRATION_INSTRUCTIONS;
}

