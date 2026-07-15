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

## Goal

<!-- The end state that defines success. What must be true when this task is done. -->

## Non-Goal

<!-- Explicitly out of scope. What this task will NOT do, and actions agents must NOT attempt on their own (e.g. production release, infra/DB changes, anything irreversible). Only list exclusions grounded in the request or standard safety — do not narrow intent by inventing out-of-scope items. -->

## Assumptions

<!-- Facts that could NOT be confirmed from the request or linked resources but had to be assumed to fill in the sections above. Mark each item as "- (assumption) ..." so a human can catch and correct wrong guesses. Leave empty if nothing was assumed. -->

## Context

<!-- Background information and why this task is needed -->

## Requirements

<!-- Specific functional/technical requirements the implementation must meet. -->

## Acceptance Criteria

<!-- Observable, checkable conditions that define "done". Each item is a checkbox tagged (auto) or (manual):
  - (auto): an agent can verify it with evidence (command exit code, code presence, API behavior). Write these to be objectively verifiable.
  - (manual): requires a human to confirm (e.g. visual QA in dev, staging sign-off). Agents never attempt these; they are handed off.
  Put actions an agent must not perform under Non-Goal, not here. -->

- [ ] (auto)

## Repository Constraints

<!-- Auto-populated by constraint discovery: lint, test, build commands per repository -->

## Related Resources

<!-- Links to issues, documentation, etc. -->
`;
}
