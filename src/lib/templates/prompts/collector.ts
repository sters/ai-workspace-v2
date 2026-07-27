/**
 * Prompt template for workspace-collect-reviews agent.
 * Collects review results and generates a summary report.
 */

import type { CollectorInput } from "@/types/prompts";
import { NO_CD_RULES, WRITTEN_DELIVERABLE_LENGTH } from "./shared";

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
   - Code Reviews: Extract repository name, overall assessment, critical/warning/suggestion counts, and individual warning descriptions. Reviewers annotate findings with \`(Confidence: high|medium|low)\` — **preserve those annotations verbatim** on every finding you carry into the summary, and count how many findings are low-confidence. The autonomous gate uses confidence to decide what is worth another cycle, so stripping it silently promotes speculation to fact
   - TODO Verifications: Extract verified/unverified/partial/incomplete/skipped counts and completion rate
   - README Verifications: Extract satisfied/unsatisfied/partial/pending-human counts and satisfaction rate. PENDING-HUMAN items are (manual) acceptance criteria awaiting human confirmation — collect their descriptions
   - Constraint Verifications: Extract pass/fail/skipped/pre-existing status per constraint with exit codes and duration

2. **Create Summary Report** at the specified path following the template structure:
   - Per-repository sections with links to all review/verification files
   - If a \`REVIEW-cross-repository.md\` file is present, give it its own "Cross-Repository" section (it reviews issues that span multiple repos, e.g. API/contract mismatches) and surface any of its Critical Issues in the top priority list
   - Code Review metrics as a table (Overall Assessment, Critical Issues, Warnings, Suggestions, Low-Confidence Findings)
   - Warning descriptions as a numbered list directly after the Code Review table (no separate heading), each keeping its \`(Confidence: ...)\` annotation
   - TODO Verification status as a table with completion rate
   - README Verification status as a table with satisfaction rate (satisfaction rate is over auto/agent-verifiable criteria only). If any PENDING-HUMAN items exist, list them as a "Manual verification needed" checklist so a human knows what to confirm — these are handoffs, not failures
   - Constraint Verification results as a table per repository (Constraint, Status, Exit Code, Duration). If ANY constraint has status FAIL, add it as a **Critical Issue**. SKIPPED and PRE-EXISTING constraints are informational — note them but do NOT flag as critical
   - Do NOT include an Aggregate Statistics section

${WRITTEN_DELIVERABLE_LENGTH}

${NO_CD_RULES}

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
