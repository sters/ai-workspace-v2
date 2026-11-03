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
- {Issue description} (Confidence: high|medium|low)

#### Warnings
- {Warning description} (Confidence: high|medium|low)

#### Suggestions
- {Suggestion} (Confidence: high|medium|low)

#### Positive Feedback
- {Good practice}

## Overall Assessment

**Code Quality**: {Rating}
**Test Coverage**: {Assessment}
**Security**: {Assessment}

## Recommendations

1. {Recommendation}

## Conclusion

{What this change is and what state it is in. Describe; do not rule. This section must NOT say whether the branch can merge, ship, or is "review-ready", and must NOT call the findings blocking or non-blocking — that decision is made downstream from your findings plus context you cannot see here.}

## Recurring (previously accepted)

{One line per finding already on the workspace's Known / Accepted Findings list, marked (Recurring). Omit this section entirely when there are none. These do not count toward the Critical / Warning / Suggestion totals above.}
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

export const RESEARCH_RECOMMENDATIONS_REPO_TEMPLATE = `# Recommendations: {Repository Name}

**Based on**: findings-{repository}.md, findings-cross-repository.md

## High Priority
## Medium Priority
## Low Priority
`;

export const RESEARCH_NEXT_STEPS_TEMPLATE = `# Next Steps

{Concrete next steps to take}
`;

export const RESEARCH_NEXT_STEPS_REPO_TEMPLATE = `# Next Steps: {Repository Name}

**Based on**: findings-{repository}.md, findings-cross-repository.md

## Immediate Actions
## Short-term
## Long-term
`;

export const REPORT_TEMPLATES = {
  "review-report-template.md": REVIEW_REPORT_TEMPLATE,
} as const;

export const RESEARCH_REPORT_TEMPLATES = {
  "summary.md": RESEARCH_SUMMARY_TEMPLATE,
  "findings-repository.md": RESEARCH_FINDINGS_REPO_TEMPLATE,
  "findings-cross-repository.md": RESEARCH_FINDINGS_CROSS_REPO_TEMPLATE,
  "findings-others.md": RESEARCH_FINDINGS_OTHERS_TEMPLATE,
  "recommendations.md": RESEARCH_RECOMMENDATIONS_TEMPLATE,
  "recommendations-repository.md": RESEARCH_RECOMMENDATIONS_REPO_TEMPLATE,
  "next-steps.md": RESEARCH_NEXT_STEPS_TEMPLATE,
  "next-steps-repository.md": RESEARCH_NEXT_STEPS_REPO_TEMPLATE,
} as const;
