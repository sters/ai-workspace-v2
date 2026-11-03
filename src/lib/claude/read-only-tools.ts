/**
 * `allowedTools` for a child that must only read. Passing it replaces the
 * Edit / Write and `Bash(git:*)` grant `addDirs` would otherwise add, so the
 * child can read those directories but not change them; git is limited to
 * commands that only read.
 */
export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)"];
