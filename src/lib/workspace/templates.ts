/**
 * Workspace templates — TODO, review, and report template management.
 */

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_DIR } from "../config";

// ---------------------------------------------------------------------------
// TODO Templates
// ---------------------------------------------------------------------------

const TODO_FEATURE_TEMPLATE = `# TODO: {{REPOSITORY_NAME}}

## Initialize

Before starting implementation, read the following documentation:

- **README.md** — Understand project overview, setup, and development workflow
- **CLAUDE.md** (if exists) — Identify build/test/lint commands and coding conventions
- **CONTRIBUTING.md** (if exists) — Understand PR process and code style requirements

## Implementation Tasks

- [ ] **[TBD]** (Replace with specific implementation tasks)
  - Target: (Specify exact file path)
  - Action: (Describe exactly what to add/modify)
  - Pattern: (Reference existing similar code if applicable)

- [ ] **[TBD]** (Replace with specific test tasks)
  - Target: (Specify test file path)
  - Action: (Describe test cases to add)
  - Verify: (Specify test command)

## Verification

- [ ] **[Repository]** Run test suite
  - Target: Repository root
  - Action: Execute test command from CLAUDE.md/README.md or \`make test\`
  - Verify: All tests pass

- [ ] **[Repository]** Run linter
  - Target: Repository root
  - Action: Execute lint command from CLAUDE.md/README.md or \`make lint\`
  - Verify: No lint errors

## Finalize

- [ ] **[Git]** Commit changes
  - Target: Git repository
  - Action: Review \`git log\` for commit message style, then commit with descriptive message

## Notes

<!-- Add any notes, blockers, dependencies, or additional context here -->
`;

const TODO_BUGFIX_TEMPLATE = `# TODO: {{REPOSITORY_NAME}}

## Initialize

Before starting investigation, read the following documentation:

- **README.md** — Understand project overview, setup, and development workflow
- **CLAUDE.md** (if exists) — Identify build/test/lint commands and coding conventions

## Bug Investigation

- [ ] **[TBD]** Reproduce the bug locally
  - Target: (Specify file/endpoint/component where bug occurs)
  - Action: (Describe exact steps to reproduce)
  - Verify: (Describe expected vs actual behavior)

- [ ] **[TBD]** Identify root cause
  - Target: (Specify suspected file/function)
  - Action: (Describe what to investigate)

## Bug Fix Tasks

- [ ] **[TBD]** (Replace with specific fix implementation)
  - Target: (Specify exact file path)
  - Action: (Describe exactly what to change and why)

- [ ] **[TBD]** Add regression test
  - Target: (Specify test file path)
  - Action: (Describe test case that would have caught this bug)
  - Verify: Test fails without fix, passes with fix

## Verification

- [ ] **[Repository]** Run test suite
  - Target: Repository root
  - Action: Execute test command from CLAUDE.md/README.md or \`make test\`
  - Verify: All tests pass (including new regression test)

- [ ] **[Repository]** Run linter
  - Target: Repository root
  - Action: Execute lint command from CLAUDE.md/README.md or \`make lint\`
  - Verify: No lint errors

## Finalize

- [ ] **[Git]** Commit changes
  - Target: Git repository
  - Action: Review \`git log\` for commit message style, then commit with descriptive message

## Notes

<!-- Add any notes, blockers, dependencies, or additional context here -->
`;

const TODO_RESEARCH_TEMPLATE = `# TODO: {{REPOSITORY_NAME}}

## Initialize

Before starting research, read the following documentation:

- **README.md** — Understand project overview and architecture
- **CLAUDE.md** (if exists) — Identify project conventions and tooling

## Research Tasks

- [ ] **[TBD]** (Replace with specific investigation task)
  - Target: (Specify files/docs to analyze)
  - Action: (Describe what to find out)

## Documentation

- [ ] **[Workspace README.md]** Document findings
  - Target: Workspace README.md
  - Action: Add research findings under a Findings section

## Notes

<!-- Add any notes, blockers, or additional context here -->
`;

const TODO_DEFAULT_TEMPLATE = `# TODO: {{REPOSITORY_NAME}}

## Initialize

Before starting, read the following documentation:

- **README.md** — Understand project overview, setup, and development workflow
- **CLAUDE.md** (if exists) — Identify build/test/lint commands and coding conventions

## Tasks

- [ ] **[TBD]** (Replace with specific task)
  - Target: (Specify exact file/component)
  - Action: (Describe exactly what to do)

## Verification

- [ ] **[Repository]** Run test suite (if applicable)
  - Target: Repository root
  - Action: Execute test command from CLAUDE.md/README.md
  - Verify: All tests pass

## Notes

<!-- Add any notes, blockers, dependencies, or additional context here -->
`;

function selectTodoTemplate(taskType: string): string {
  switch (taskType.toLowerCase()) {
    case "feature":
    case "implementation":
      return TODO_FEATURE_TEMPLATE;
    case "bugfix":
    case "bug":
      return TODO_BUGFIX_TEMPLATE;
    case "research":
      return TODO_RESEARCH_TEMPLATE;
    default:
      return TODO_DEFAULT_TEMPLATE;
  }
}

/**
 * Write the appropriate TODO template to {wsPath}/TODO-template.md
 * based on the task type.
 */
export async function writeTodoTemplate(wsPath: string, taskType: string): Promise<void> {
  const template = selectTodoTemplate(taskType);
  await Bun.write(path.join(wsPath, "TODO-template.md"), template);
}

// ---------------------------------------------------------------------------
// Report Templates
// ---------------------------------------------------------------------------

const REVIEW_REPORT_TEMPLATE = `# Code Review: {repository_name}

**Task**: {task_name}
**Repository**: {repository_path}
**Base Branch**: {base_branch}
**Review Date**: {timestamp}

## Summary

{Brief overview of changes}

## Changed Files

{List of changed files}

## Detailed Review

### {File Path}

**Change Type**: Added/Modified/Deleted
**Summary**: {What changed}

#### Critical Issues
- {Issue description}

#### Warnings
- {Warning description}

#### Suggestions
- {Suggestion}

#### Positive Feedback
- {Good practice}

## Overall Assessment

**Code Quality**: {Rating}
**Test Coverage**: {Assessment}
**Security**: {Assessment}

## Recommendations

1. {Recommendation}

## Conclusion

{Final assessment}
`;

const VERIFICATION_REPORT_TEMPLATE = `# TODO Verification: {repository_name}

**Task**: {task_name}
**Repository**: {repository_path}
**Base Branch**: {base_branch}
**Verification Date**: {timestamp}

## Summary

| Status | Count |
|--------|-------|
| Verified | {count} |
| Unverified | {count} |
| Partial | {count} |
| Incomplete | {count} |
| Unmarked | {count} |
| Skipped | {count} |

**Completion Rate**: {pct}% ({completed} / {total})

## Verified Items

## Partial Items

## Issues Found

### Unverified (marked done, no evidence)

### Incomplete (not done)

### Unmarked (done but not checked)

## Skipped Items

## Changed Files Reference

## Recommendations
`;

const RESEARCH_REPORT_TEMPLATE = `# Research Report

**Workspace**: {workspace_name}
**Date**: {date}

## Research Objectives

{Objectives from README}

## Repositories Analyzed

| Repository | Path | Description |
|------------|------|-------------|

## Findings

### {Repository Name}

**Overview**: {Brief description}

#### Structure
#### Relevant Code
#### Issues / Observations

## Cross-Repository Analysis

### Dependencies
### Integration Points
### Common Patterns
### Gaps

## Recommendations

## Next Steps
`;

const SUMMARY_REPORT_TEMPLATE = `# Workspace Review Summary

**Workspace**: {workspace-name}
**Review Date**: {timestamp}
**Repositories Reviewed**: {count}

## Overview

{Brief overview}

## Summary by Repository

### {Repository Name}

- **Review File**: [{filename}](./{filename})
- **Overall Assessment**: {assessment}
- **Critical Issues**: {count}
- **Warnings**: {count}
- **Suggestions**: {count}

## Aggregate Statistics

- **Total Critical Issues**: {sum}
- **Total Warnings**: {sum}
- **Total Suggestions**: {sum}

## Top Priority Issues

## Overall Recommendations

## Conclusion
`;

/**
 * Write all report templates to the workspace directory.
 * These are used by review, verification, research, and summary agents.
 */
export async function writeReportTemplates(wsPath: string): Promise<void> {
  await Promise.all([
    Bun.write(path.join(wsPath, "review-report-template.md"), REVIEW_REPORT_TEMPLATE),
    Bun.write(path.join(wsPath, "verification-report-template.md"), VERIFICATION_REPORT_TEMPLATE),
    Bun.write(path.join(wsPath, "research-report-template.md"), RESEARCH_REPORT_TEMPLATE),
    Bun.write(path.join(wsPath, "summary-report-template.md"), SUMMARY_REPORT_TEMPLATE),
  ]);
}

// ---------------------------------------------------------------------------
// prepareReviewDir
// ---------------------------------------------------------------------------

export function prepareReviewDir(workspaceName: string): string {
  const wsPath = path.join(WORKSPACE_DIR, workspaceName);
  if (!existsSync(wsPath)) {
    throw new Error(`Workspace directory not found: ${wsPath}`);
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");

  const reviewDir = path.join(wsPath, "artifacts", "reviews", timestamp);
  mkdirSync(reviewDir, { recursive: true });
  return timestamp;
}
