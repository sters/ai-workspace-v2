/**
 * README template builder for new workspaces.
 */

export function buildReadmeContent(description: string, taskType: string, ticketId: string, date: string): string {
  return `# Task: TBD

## Initial Request

${description}

## Overview

**Task Type**: ${taskType}
**Ticket ID**: ${ticketId}
**Date**: ${date}

## Workspace Structure

| Path | Description |
|------|-------------|
| \`README.md\` | Task overview, objectives, requirements, and context. Updated throughout the task. |
| \`TODO-{repo}.md\` | Checklist of tasks for each repository. Created by planner agent. |
| \`artifacts/\` | **Persistent directory for keeping important outputs.** Research results, investigation notes, reference materials, etc. Git-tracked. |
| \`tmp/\` | **Temporary directory for agent use.** Intermediate files, scratch work, etc. Contents are gitignored. |
| \`artifacts/reviews/\` | Code review reports. |
| \`{org}/{repo}/\` | Git worktrees for each repository. Work is done here. |

This workspace is a git repository. Changes to \`README.md\`, \`TODO-*.md\`, and \`artifacts/\` (including \`artifacts/reviews/\`) are tracked. Use \`git log\` to view history.

**Gitignored:** \`tmp/\`, \`*.tmp\`, \`*.log\`, repository worktrees (\`github.com/\`, \`gitlab.com/\`, \`bitbucket.org/\`)

## Repositories

<!-- Fill in before running setup-repository.sh -->

## Objective

<!-- Describe what needs to be accomplished -->

## Context

<!-- Background information and why this task is needed -->

## Requirements

<!-- Specific requirements and acceptance criteria -->

## Repository Constraints

<!-- Auto-populated by constraint discovery: lint, test, build commands per repository -->

## Related Resources

<!-- Links to issues, documentation, etc. -->
`;
}
