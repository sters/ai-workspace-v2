/**
 * `allowedTools` for a child that must only read. Passing it replaces the
 * Edit / Write and `Bash(git:*)` grant `addDirs` would otherwise add, so the
 * child can read those directories but not change them; git is limited to
 * commands that only read.
 */
export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)"];

/**
 * The grant `addDirs` generates when no `allowedTools` is given: Edit / Write
 * under each directory, plus `Bash(git:*)`. Pass it as `allowedTools` to keep a
 * child's writes to these directories while `addDirs` also lists others it
 * should only read (for their skills).
 */
export function writeGrants(dirs: string[]): string[] {
  return [
    // The CLI reads `/path` as project-root-relative and `//path` as absolute.
    ...dirs.flatMap((dir) => {
      const abs = dir.startsWith("/") ? `/${dir}` : `//${dir}`;
      return [`Edit(${abs}/**)`, `Write(${abs}/**)`];
    }),
    "Bash(git:*)",
  ];
}
