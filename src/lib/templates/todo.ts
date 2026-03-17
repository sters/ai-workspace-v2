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

export const TODO_BUGFIX_TEMPLATE = `# TODO: {{REPOSITORY_NAME}}

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
