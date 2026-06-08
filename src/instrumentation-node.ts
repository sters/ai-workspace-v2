/**
 * Node.js-only instrumentation logic.
 * Separated from instrumentation.ts so Next.js does not bundle these
 * heavy server-side imports for the Edge Runtime.
 */
export async function registerNode() {
  // Initialize SQLite database
  const { getDb } = await import("@/lib/db");
  getDb();

  // Mark stale chat sessions as exited (from previous crash)
  const { markAllSessionsExited } = await import("@/lib/db");
  markAllSessionsExited();

  // Sync auto-managed Claude Code hooks into .claude/settings.local.json
  const { syncManagedHooks } = await import("@/lib/claude/hooks/sync");
  await syncManagedHooks().catch((err) => console.warn("[hooks] sync failed:", err));

  // Settle operations that were interrupted by server shutdown.
  // We do NOT resume them — interrupted phases can't continue and resuming
  // re-runs side effects. Stale "running" rows are marked failed/completed.
  const { failStaleOperations } = await import("@/lib/pipeline-manager");
  failStaleOperations();
}
