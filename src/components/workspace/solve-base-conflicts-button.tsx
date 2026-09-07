"use client";

import { GitMerge } from "lucide-react";
import type { OperationType } from "@/types/operation";

/**
 * Starts the `resolve-base-conflicts` operation: merge each open PR's base
 * branch back in, resolve whatever conflicts with an agent, push.
 *
 * Unlike the "Address PR Reviews" button it sits next to, this one is not a
 * quick-fill — there is no instruction a TODO-driven run could carry, because
 * the executor is forbidden from pushing and the merge has to be committed and
 * pushed by the same phase that verified it. So the click starts the operation
 * directly, and the label says "Solve", not "describe".
 */
export function SolveBaseConflictsButton({
  workspacePath,
  repo,
  disabled,
  onStart,
}: {
  workspacePath: string;
  /** Narrows the merge to one repository. Omit for every worktree in the workspace. */
  repo?: string;
  disabled: boolean;
  onStart: (type: OperationType, body: Record<string, string>) => void;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded border border-border bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
      disabled={disabled}
      title={
        repo
          ? `Merge ${repo}'s PR base branch into its branch, resolve conflicts, and push`
          : "Merge each open PR's base branch into its branch, resolve conflicts, and push"
      }
      onClick={() =>
        onStart("resolve-base-conflicts", {
          workspace: workspacePath,
          ...(repo ? { repo } : {}),
        })
      }
    >
      <GitMerge className="h-3.5 w-3.5" />
      Solve PR base branch conflicts
    </button>
  );
}
