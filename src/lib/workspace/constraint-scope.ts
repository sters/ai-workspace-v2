/**
 * Placeholders that narrow a constraint command to what the branch changed, so
 * a monorepo is not linted and tested whole on every run.
 *
 * - `{base}` — the merge-base SHA with `origin/<base branch>`, for a tool's own
 *   change detection (`--filter=...[{base}]`, `--new-from-rev={base}`,
 *   `affected --base={base}`).
 * - `{changed_files}` — the files the branch added or modified against the
 *   merge-base, committed or not, shell-quoted and space-separated. Deleted
 *   files are left out.
 *
 * A command using either declares a `fullCommand` to run when the scope cannot
 * be resolved. A command that lists files is skipped when no file is in scope,
 * since many tools read an empty list as "everything".
 */

import type { RepoConstraint } from "@/lib/parsers/readme";
import { runGit, type GitExec } from "./git-exec";

export const BASE_PLACEHOLDER = "{base}";
export const CHANGED_FILES_PLACEHOLDER = "{changed_files}";

export interface ConstraintScope {
  base: string;
  /** Added or modified against `base`, including uncommitted and untracked files. */
  changedFiles: string[];
  /** The subset of `changedFiles` that also exists at `base`. */
  baseFiles: string[];
}

export type ExpandedConstraint =
  | { kind: "run"; command: string }
  | { kind: "skip"; reason: string };

export function usesScope(command: string): boolean {
  return command.includes(BASE_PLACEHOLDER) || command.includes(CHANGED_FILES_PLACEHOLDER);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The command to run for one constraint. `side` picks the file list: `"head"`
 * for the branch, `"base"` for the re-run on the merge-base that tells a
 * pre-existing failure from a regression, where files the branch added do not
 * exist yet.
 */
export function expandConstraintCommand(
  constraint: RepoConstraint,
  scope: ConstraintScope | null,
  side: "head" | "base",
): ExpandedConstraint {
  const { command } = constraint;
  if (!usesScope(command)) return { kind: "run", command };

  if (!scope) {
    return constraint.fullCommand
      ? { kind: "run", command: constraint.fullCommand }
      : { kind: "skip", reason: "The merge-base could not be resolved and no full command is declared." };
  }

  const files = side === "head" ? scope.changedFiles : scope.baseFiles;
  if (command.includes(CHANGED_FILES_PLACEHOLDER) && files.length === 0) {
    return { kind: "skip", reason: "No changed file is in scope for this command." };
  }

  return {
    kind: "run",
    command: command
      .replaceAll(BASE_PLACEHOLDER, scope.base)
      .replaceAll(CHANGED_FILES_PLACEHOLDER, files.map(shellQuote).join(" ")),
  };
}

function nulSeparated(out: string): string[] {
  return out.split("\0").filter(Boolean);
}

/** The branch's scope against `origin/<baseBranch>`, or `null` when it cannot be determined. */
export async function resolveConstraintScope(
  worktreePath: string,
  baseBranch: string,
  git: GitExec = runGit,
): Promise<ConstraintScope | null> {
  const mergeBase = await git(["merge-base", "HEAD", `origin/${baseBranch}`], worktreePath);
  if (!mergeBase.ok || !mergeBase.out) return null;
  const base = mergeBase.out;

  // `--no-renames` reports a rename as a deletion plus an addition, so the new
  // path counts as changed and is not mistaken for a file that exists at base.
  const [changed, modified, untracked] = await Promise.all([
    git(["diff", "--name-only", "-z", "--no-renames", "--diff-filter=d", base], worktreePath),
    git(["diff", "--name-only", "-z", "--no-renames", "--diff-filter=MT", base], worktreePath),
    git(["ls-files", "-z", "--others", "--exclude-standard"], worktreePath),
  ]);
  if (!changed.ok || !modified.ok || !untracked.ok) return null;

  return {
    base,
    changedFiles: [...new Set([...nulSeparated(changed.out), ...nulSeparated(untracked.out)])],
    baseFiles: nulSeparated(modified.out),
  };
}
