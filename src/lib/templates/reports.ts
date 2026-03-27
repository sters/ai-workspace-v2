/**
 * Report template strings for review, verification, research, and summary.
 */

export const REVIEW_REPORT_TEMPLATE = `# Code Review: {repository_name}

- **Task**: {task_name}
- **Repository**: {repository_path}
- **Base Branch**: {base_branch}
- **Review Date**: {timestamp}

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

export const VERIFICATION_REPORT_TEMPLATE = `# TODO Verification: {repository_name}

- **Task**: {task_name}
- **Repository**: {repository_path}
- **Base Branch**: {base_branch}
- **Verification Date**: {timestamp}

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

export const RESEARCH_SUMMARY_TEMPLATE = `# Research Report

- **Workspace**: {workspace_name}
- **Date**: {date}

## Research Objectives

{Objectives from README}

## Repositories Analyzed

| Repository | Path | Description |
|------------|------|-------------|

## Key Findings

{Brief summary of findings across all repositories}
`;

export const RESEARCH_FINDINGS_REPO_TEMPLATE = `# Findings: {Repository Name}

**Overview**: {Brief description}

## Structure
## Relevant Code
## Issues / Observations
`;

export const RESEARCH_FINDINGS_CROSS_REPO_TEMPLATE = `# Cross-Repository Analysis

## Dependencies
## Integration Points
## Common Patterns
## Gaps
`;

export const RESEARCH_FINDINGS_OTHERS_TEMPLATE = `# Other Findings

{Findings that do not belong to a specific repository or cross-repository analysis}
`;

export const RESEARCH_RECOMMENDATIONS_TEMPLATE = `# Recommendations

{Actionable recommendations based on findings}
`;

export const RESEARCH_NEXT_STEPS_TEMPLATE = `# Next Steps

{Concrete next steps to take}
`;

export const SUMMARY_REPORT_TEMPLATE = `# Workspace Review Summary

- **Review Date**: {timestamp}
- **Repositories Reviewed**: {count}

## Overview

{Brief overview}

## Summary by Repository

### {Repository Name}

- **Review File**: [{filename}](./{filename})
- **TODO Verification**: [{filename}](./{filename})
- **README Verification**: [{filename}](./{filename})

#### Code Review

| Metric | Count |
|--------|-------|
| Overall Assessment | {assessment} |
| Critical Issues | {count} |
| Warnings | {count} |
| Suggestions | {count} |

{Warning descriptions as numbered list, no heading needed}

#### TODO Verification

| Status | Count |
|--------|-------|
| Verified | {count} |
| Unverified | {count} |
| Partial | {count} |
| Incomplete | {count} |
| Skipped | {count} |

**Completion Rate**: {pct}% ({completed} / {total})

#### README Verification

| Status | Count |
|--------|-------|
| Satisfied | {count} |
| Unsatisfied | {count} |
| Partial | {count} |

**Satisfaction Rate**: {pct}% ({satisfied} / {total})

## Top Priority Issues

## Overall Recommendations

## Conclusion
`;

export const README_VERIFICATION_REPORT_TEMPLATE = `# README Verification: {repository_name}

- **Task**: {task_name}
- **Repository**: {repository_path}
- **Base Branch**: {base_branch}
- **Verification Date**: {timestamp}

## Summary

| Status | Count |
|--------|-------|
| Satisfied | {count} |
| Unsatisfied | {count} |
| Partial | {count} |

**Satisfaction Rate**: {pct}% ({satisfied} / {total})

## {Extracted Requirement}

- **Status**: {SATISFIED/PARTIAL/UNSATISFIED}
- **Evidence**: {file paths, code references}
- **Notes**: {additional context}

## Recommendations
`;

export const REPORT_TEMPLATES = {
  "review-report-template.md": REVIEW_REPORT_TEMPLATE,
  "verification-report-template.md": VERIFICATION_REPORT_TEMPLATE,
  "readme-verification-report-template.md": README_VERIFICATION_REPORT_TEMPLATE,
  "summary-report-template.md": SUMMARY_REPORT_TEMPLATE,
} as const;

export const RESEARCH_REPORT_TEMPLATES = {
  "summary.md": RESEARCH_SUMMARY_TEMPLATE,
  "findings-repository.md": RESEARCH_FINDINGS_REPO_TEMPLATE,
  "findings-cross-repository.md": RESEARCH_FINDINGS_CROSS_REPO_TEMPLATE,
  "findings-others.md": RESEARCH_FINDINGS_OTHERS_TEMPLATE,
  "recommendations.md": RESEARCH_RECOMMENDATIONS_TEMPLATE,
  "next-steps.md": RESEARCH_NEXT_STEPS_TEMPLATE,
} as const;
