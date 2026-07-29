/**
 * TODO template strings for different task types.
 */

export const TODO_FEATURE_TEMPLATE = `# TODO: {{REPOSITORY_NAME}}

## Initialize

<!-- Context for the executor, NOT a checklist. Do not turn these into TODO items. -->

Before starting implementation, read the following documentation:

- **README.md** — Understand project overview, setup, and development workflow
- **CLAUDE.md** (if exists) — Identify build/test/lint commands and coding conventions
- **CONTRIBUTING.md** (if exists) — Understand PR process and code style requirements

## Implementation Tasks

<!--
Every code-change item carries Target / Action / Verify. Pattern and Why are conditional — include
them only where they change what the executor writes; never write "Pattern: none" to fill the field.
Target must be path:line OR path + the exact symbol/function name — never a vague string like "relevant module".
Verify is the item's acceptance condition: one check that can pass or fail, scoped as narrowly as the
item allows (the one test path, not the whole suite).
-->

- [ ] **[TBD]** (Replace with specific implementation task — one atomic change per item)
  - Target: (path:line, OR path + symbol/function name)
  - Action: (Concrete step-by-step recipe — name the import, the function, the literal to change)
  - Verify: (Concrete check that can pass or fail: narrowest shell command, test assertion, or observable behavior)
  - Pattern: (only where the convention to follow is non-obvious — existing code to mirror at path:line)
  - Why: (only where the Action doesn't already make it obvious — what stays broken without this)

- [ ] **[TBD]** (Replace with specific test task)
  - Target: (Test file path + the test name to add)
  - Action: (Describe the test case to add — arrange/act/assert)
  - Verify: (Exact test command, narrowed to this test's path)
  - Pattern: (only where the test style is non-obvious — existing test to mirror at path:line)

## Verification

<!--
Remove this section if the task does not involve code changes.
ONE item only. Do NOT expand the README's \`## Repository Constraints\` into one item per command:
the executor already runs the full declared set before marking anything complete, and the review
pipeline runs it again afterwards with a merge-base comparison. Per-item checks belong in \`Verify:\`.
-->

- [ ] **[Repository]** Run the declared constraint set once the implementation items are done
  - Target: Repository root
  - Action: Run every command listed for this repository under the workspace README's \`## Repository Constraints\`
  - Verify: Each command exits 0, or its failure also reproduces on the base branch

## Finalize

- [ ] **[Git]** Commit changes
  - Target: Git repository
  - Action: Review \`git log\` for commit message style, then commit with descriptive message

## Notes

<!-- Add any notes, blockers, dependencies, or additional context here -->
`;

export const TODO_BUGFIX_TEMPLATE = `# TODO: {{REPOSITORY_NAME}}

## Initialize

<!-- Context for the executor, NOT a checklist. Do not turn these into TODO items. -->

Before starting investigation, read the following documentation:

- **README.md** — Understand project overview, setup, and development workflow
- **CLAUDE.md** (if exists) — Identify build/test/lint commands and coding conventions

## Bug Investigation

<!--
Investigation items are looser (they're exploratory).
Bug-fix items below are code changes — they carry Target / Action / Verify, plus Pattern and Why only
where those change what the executor writes.
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
  - Verify: (Reproduce steps now pass, plus the narrowest test command covering this path)
  - Pattern: (only where the correct shape is non-obvious — existing code to mirror at path:line)
  - Why: (only where the Action doesn't already make it obvious — what incorrect behavior remains)

- [ ] **[TBD]** Add regression test
  - Target: (Test file path + the new test name)
  - Action: (Test case that would have caught this bug — arrange/act/assert)
  - Verify: Test fails on the buggy code, passes after the fix

## Verification

<!--
Remove this section if the task does not involve code changes.
ONE item only. Do NOT expand the README's \`## Repository Constraints\` into one item per command:
the executor already runs the full declared set before marking anything complete, and the review
pipeline runs it again afterwards with a merge-base comparison. Per-item checks belong in \`Verify:\`.
-->

- [ ] **[Repository]** Run the declared constraint set once the implementation items are done
  - Target: Repository root
  - Action: Run every command listed for this repository under the workspace README's \`## Repository Constraints\`
  - Verify: Each command exits 0, or its failure also reproduces on the base branch

## Finalize

- [ ] **[Git]** Commit changes
  - Target: Git repository
  - Action: Review \`git log\` for commit message style, then commit with descriptive message

## Notes

<!-- Add any notes, blockers, dependencies, or additional context here -->
`;

export const TODO_RESEARCH_TEMPLATE = `# TODO: {{REPOSITORY_NAME}}

## Initialize

<!-- Context for the executor, NOT a checklist. Do not turn these into TODO items. -->

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

<!-- Context for the executor, NOT a checklist. Do not turn these into TODO items. -->

Before starting, read the following documentation:

- **README.md** — Understand project overview, setup, and development workflow
- **CLAUDE.md** (if exists) — Identify build/test/lint commands and coding conventions

## Tasks

- [ ] **[TBD]** (Replace with specific task)
  - Target: (Specify exact file/component)
  - Action: (Describe exactly what to do)

## Verification

<!--
Remove this section if the task does not involve code changes.
ONE item only. Do NOT expand the README's \`## Repository Constraints\` into one item per command:
the executor already runs the full declared set before marking anything complete, and the review
pipeline runs it again afterwards with a merge-base comparison. Per-item checks belong in \`Verify:\`.
-->

- [ ] **[Repository]** Run the declared constraint set once the implementation items are done
  - Target: Repository root
  - Action: Run every command listed for this repository under the workspace README's \`## Repository Constraints\`
  - Verify: Each command exits 0, or its failure also reproduces on the base branch

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
