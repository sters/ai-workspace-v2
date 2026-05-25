/**
 * TODO template strings for different task types.
 */

export const TODO_FEATURE_TEMPLATE = `# TODO: {{REPOSITORY_NAME}}

## Initialize

Before starting implementation, read the following documentation:

- **README.md** — Understand project overview, setup, and development workflow
- **CLAUDE.md** (if exists) — Identify build/test/lint commands and coding conventions
- **CONTRIBUTING.md** (if exists) — Understand PR process and code style requirements

## Implementation Tasks

<!--
Each code-change item below MUST include every field (Target/Action/Pattern/Why/Verify/Acceptance).
Target must be path:line OR path + the exact symbol/function name — never a vague string like "relevant module".
-->

- [ ] **[TBD]** (Replace with specific implementation task — one atomic change per item)
  - Target: (path:line, OR path + symbol/function name)
  - Action: (Concrete step-by-step recipe — name the import, the function, the literal to change)
  - Pattern: (Existing code to mirror at path:line, OR "none (greenfield)")
  - Why: (Motivation — what breaks without this change, one sentence)
  - Verify: (Concrete check: shell command, test to add, or observable behavior)
  - Acceptance: (Test-checkable fact, e.g. "Unit test at path/to/test.ts passes")

- [ ] **[TBD]** (Replace with specific test task)
  - Target: (Test file path + the test name to add)
  - Action: (Describe the test case to add — arrange/act/assert)
  - Pattern: (Existing test to mirror at path:line)
  - Why: (What regression this test prevents)
  - Verify: (Exact test command to run)
  - Acceptance: (Test passes; without the fix it would have failed)

## Verification

<!-- Remove this section if the task does not involve code changes -->

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

export const TODO_BUGFIX_TEMPLATE = `# TODO: {{REPOSITORY_NAME}}

## Initialize

Before starting investigation, read the following documentation:

- **README.md** — Understand project overview, setup, and development workflow
- **CLAUDE.md** (if exists) — Identify build/test/lint commands and coding conventions

## Bug Investigation

<!--
Investigation items are looser (they're exploratory).
Bug-fix items below are code changes — they MUST carry the full Target/Action/Pattern/Why/Verify/Acceptance fields.
Target on fix items must be path:line OR path + symbol/function name — no vague strings.
-->

- [ ] **[TBD]** Reproduce the bug locally
  - Target: (file/endpoint/component where bug occurs)
  - Action: (Exact steps to reproduce)
  - Verify: (Expected vs actual behavior)

- [ ] **[TBD]** Identify root cause
  - Target: (Suspected file/function)
  - Action: (What to investigate)

## Bug Fix Tasks

- [ ] **[TBD]** (Replace with specific fix implementation)
  - Target: (path:line, OR path + symbol/function name)
  - Action: (Concrete change — name the literal, the condition, the call site)
  - Pattern: (Existing correct code to mirror at path:line, OR "none — root cause is a missing branch")
  - Why: (What incorrect behavior this fix prevents)
  - Verify: (Reproduce steps now pass; lint/test commands)
  - Acceptance: (Regression test below passes; original repro no longer triggers the bug)

- [ ] **[TBD]** Add regression test
  - Target: (Test file path + the new test name)
  - Action: (Test case that would have caught this bug — arrange/act/assert)
  - Pattern: (Existing test to mirror at path:line)
  - Why: (Prevents reintroducing this specific bug)
  - Verify: Test fails on the buggy code, passes after the fix
  - Acceptance: New test is part of the default test command output

## Verification

<!-- Remove this section if the task does not involve code changes -->

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

export const TODO_RESEARCH_TEMPLATE = `# TODO: {{REPOSITORY_NAME}}

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

export const TODO_DEFAULT_TEMPLATE = `# TODO: {{REPOSITORY_NAME}}

## Initialize

Before starting, read the following documentation:

- **README.md** — Understand project overview, setup, and development workflow
- **CLAUDE.md** (if exists) — Identify build/test/lint commands and coding conventions

## Tasks

- [ ] **[TBD]** (Replace with specific task)
  - Target: (Specify exact file/component)
  - Action: (Describe exactly what to do)

## Verification

<!-- Remove this section if the task does not involve code changes -->

- [ ] **[Repository]** Run test suite (if applicable)
  - Target: Repository root
  - Action: Execute test command from CLAUDE.md/README.md
  - Verify: All tests pass

## Notes

<!-- Add any notes, blockers, dependencies, or additional context here -->
`;

export function selectTodoTemplate(taskType: string): string {
  switch (taskType.toLowerCase()) {
    case "feature":
    case "implementation":
      return TODO_FEATURE_TEMPLATE;
    case "bugfix":
    case "bug":
      return TODO_BUGFIX_TEMPLATE;
    case "research":
      return TODO_RESEARCH_TEMPLATE;
    case "review":
      return TODO_DEFAULT_TEMPLATE; // unused — review skips TODO planning
    default:
      return TODO_DEFAULT_TEMPLATE;
  }
}
