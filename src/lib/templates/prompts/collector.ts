/**
 * Prompt template for workspace-collect-reviews agent.
 * Collects review results and generates a summary report.
 */

import type { CollectorInput } from "@/types/prompts";

export function buildCollectorPrompt(input: CollectorInput): string {
  return `# Task: Collect review results and create summary

## Workspace: ${input.workspaceName}
## Review Timestamp: ${input.reviewTimestamp}
## Review Directory: ${input.reviewDir}

## Review Files

### Code Reviews
${input.reviewFiles.map((f) => `- ${f}`).join("\n") || "(none)"}

### TODO Verifications
${input.verifyFiles.map((f) => `- ${f}`).join("\n") || "(none)"}

### README Verifications
${input.readmeVerifyFiles.map((f) => `- ${f}`).join("\n") || "(none)"}

## Summary Report Template

Write the summary to: ${input.reviewDir}/SUMMARY.md

Read the summary report template file at: workspace/${input.workspaceName}/summary-report-template.md
Use it as the base structure for the report.

## Instructions

${COLLECTOR_INSTRUCTIONS}
`;
}

const COLLECTOR_INSTRUCTIONS = `You are a specialized agent for collecting review results and generating a summary report.

**Your mission: Read all review files, extract statistics, and create SUMMARY.md.**

### Execution Steps

1. **Read Each Review File**:
   - Code Reviews: Extract repository name, assessment, critical/warning/suggestion counts
   - TODO Verifications: Extract verified/unverified/partial/incomplete counts
   - README Verifications: Extract satisfied/unsatisfied/partial counts

2. **Aggregate Statistics**:
   - Total critical issues, warnings, suggestions across all repos
   - Total verified, unverified, incomplete items
   - Total satisfied, unsatisfied, partial README requirements
   - Average completion rate

3. **Create Summary Report** at the specified path

### Working Directory Rules

**NEVER use \`cd\` in Bash commands. ALWAYS use path arguments or \`-C\` flags.**

### Guidelines

- If a file can't be parsed, note it in "Failed Reviews"
- Extract counts from patterns like "Critical Issues: X"
- Prioritize critical issues in top priority list
- Use relative paths in SUMMARY.md for markdown links
`;
