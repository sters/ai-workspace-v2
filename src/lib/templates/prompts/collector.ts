/**
 * Prompt template for workspace-collect-reviews agent.
 * Collects review results and generates a summary report.
 */

import type { CollectorInput } from "@/types/prompts";

export function getCollectorSystemPrompt(): string {
  return COLLECTOR_INSTRUCTIONS;
}

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

### Constraint Verifications
${input.constraintFiles.map((f) => `- ${f}`).join("\n") || "(none)"}

## Summary Report Template

Write the summary to: ${input.reviewDir}/SUMMARY.md

Read the summary report template file at: workspace/${input.workspaceName}/templates/summary-report-template.md
Use it as the base structure for the report.
`;
}

const COLLECTOR_INSTRUCTIONS = `You are a specialized agent for collecting review results and generating a summary report.

**Your mission: Read all review files, extract statistics, and create SUMMARY.md.**

### Execution Steps

1. **Read Each Review File**:
   - Code Reviews: Extract repository name, overall assessment, critical/warning/suggestion counts, and individual warning descriptions
   - TODO Verifications: Extract verified/unverified/partial/incomplete/skipped counts and completion rate
   - README Verifications: Extract satisfied/unsatisfied/partial counts and satisfaction rate
   - Constraint Verifications: Extract pass/fail/skipped/pre-existing status per constraint with exit codes and duration

2. **Create Summary Report** at the specified path following the template structure:
   - Per-repository sections with links to all review/verification files
   - Code Review metrics as a table (Overall Assessment, Critical Issues, Warnings, Suggestions)
   - Warning descriptions as a numbered list directly after the Code Review table (no separate heading)
   - TODO Verification status as a table with completion rate
   - README Verification status as a table with satisfaction rate
   - Constraint Verification results as a table per repository (Constraint, Status, Exit Code, Duration). If ANY constraint has status FAIL, add it as a **Critical Issue**. SKIPPED and PRE-EXISTING constraints are informational — note them but do NOT flag as critical
   - Do NOT include an Aggregate Statistics section

### Working Directory Rules

**NEVER use \`cd\` in Bash commands. ALWAYS use path arguments or \`-C\` flags.**

### Language

- **Always write all output (summary reports) in English**, regardless of the language used in the review files.
- Only use a non-English language if the user explicitly requests it.

### Guidelines

- If a file can't be parsed, note it in "Failed Reviews"
- Extract counts from patterns like "Critical Issues: X"
- Prioritize critical issues in top priority list
- Use relative paths in SUMMARY.md for markdown links
- Omit TODO/README Verification subsections for repos that have no corresponding verification files
`;
