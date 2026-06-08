import { listRunningOperations, updateOperationStatus } from "@/lib/db";

// ---------------------------------------------------------------------------
// Stale operation cleanup on startup
// ---------------------------------------------------------------------------
//
// Operations that were "running" when the server shut down can never continue
// on their own — their in-memory pipeline state (child processes, abort
// controllers, phase closures) is gone. We intentionally do NOT resume them:
// re-running interrupted phases re-executes side effects (git branches,
// worktrees, PRs) and frequently revives operations that didn't need it.
//
// Instead we settle each stale row so the dashboard doesn't show forever-
// "running" operations: if every saved phase already completed, mark it
// completed; otherwise mark it failed.

export function failStaleOperations(): void {
  const stale = listRunningOperations();
  if (stale.length === 0) return;

  console.log(`[cleanup] Settling ${stale.length} interrupted operation(s) from previous session`);

  const now = new Date().toISOString();
  for (const op of stale) {
    const savedPhases = op.phases ?? [];
    const allCompleted =
      savedPhases.length > 0 && savedPhases.every((p) => p.status === "completed");

    if (allCompleted) {
      console.log(`[cleanup] All phases completed for ${op.type}/${op.id}, marking as completed`);
      updateOperationStatus(op.id, "completed", now);
    } else {
      console.log(`[cleanup] Marking interrupted ${op.type}/${op.id} as failed`);
      updateOperationStatus(op.id, "failed", now);
    }
  }
}
