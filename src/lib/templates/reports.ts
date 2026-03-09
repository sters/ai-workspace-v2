/**
 * Report template strings for review, verification, research, and summary.
 */

export const REVIEW_REPORT_TEMPLATE = `# Code Review: {repository_name}

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

export const VERIFICATION_REPORT_TEMPLATE = `# TODO Verification: {repository_name}

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

export const RESEARCH_REPORT_TEMPLATE = `# Research Report

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

export const SUMMARY_REPORT_TEMPLATE = `# Workspace Review Summary

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

export const README_VERIFICATION_REPORT_TEMPLATE = `# README Verification: {repository_name}

**Task**: {task_name}
**Repository**: {repository_path}
**Base Branch**: {base_branch}
**Verification Date**: {timestamp}

## Summary

| Status | Count |
|--------|-------|
| Satisfied | {count} |
| Unsatisfied | {count} |
| Partial | {count} |

**Satisfaction Rate**: {pct}% ({satisfied} / {total})

## Requirements

### Extracted Requirements

{List of requirements extracted from README}

## Satisfied Requirements

## Partial Requirements

## Unsatisfied Requirements

## Evidence

### {Requirement}
- **Status**: {SATISFIED/PARTIAL/UNSATISFIED}
- **Evidence**: {file paths, code references}
- **Notes**: {additional context}

## Recommendations
`;

export const REPORT_TEMPLATES = {
  "review-report-template.md": REVIEW_REPORT_TEMPLATE,
  "verification-report-template.md": VERIFICATION_REPORT_TEMPLATE,
  "readme-verification-report-template.md": README_VERIFICATION_REPORT_TEMPLATE,
  "research-report-template.md": RESEARCH_REPORT_TEMPLATE,
  "summary-report-template.md": SUMMARY_REPORT_TEMPLATE,
} as const;
