import type { OperationType } from "@/types/operation";

/** Operations whose `workspace` is a label (`deep-search`, `mcp:<server>`, …) rather than a workspace. */
const NON_WORKSPACE_TYPES: ReadonlySet<OperationType> = new Set<OperationType>([
  "init",
  "mcp-auth",
  "claude-login",
  "search",
  "discovery",
  "aggregate-suggestions",
  "prune-suggestions",
  "workspace-prune",
  "operation-prune",
]);

/**
 * `inputs.repo` is either the worktree directory name or the full repository
 * path, so both compare by the last segment. Two worktrees of one clone
 * (`repo:alias`) therefore count as the same repository.
 */
function repoKey(repo: string): string {
  return repo.split("/").pop() ?? repo;
}

/**
 * Whether `running` keeps an operation on `workspace` (narrowed to `repo` when
 * given) from starting: an operation without `inputs.repo` holds the whole
 * workspace, one with it holds that repository and the workspace-wide
 * operations.
 */
export function blocksOperation(
  running: { type: OperationType; workspace: string; inputs?: Record<string, string> },
  workspace: string,
  repo?: string,
): boolean {
  if (!workspace || running.workspace !== workspace) return false;
  if (NON_WORKSPACE_TYPES.has(running.type)) return false;
  const runningRepo = running.inputs?.repo;
  if (!runningRepo || !repo) return true;
  return repoKey(runningRepo) === repoKey(repo);
}
