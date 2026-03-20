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

  // Resume operations that were interrupted by server shutdown
  const { resumeStaleOperations } = await import("@/lib/pipeline-manager");
  await resumeStaleOperations();
}
