/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to initialize the database and resume interrupted operations.
 */
export async function register() {
  // Only run on the server (not in Edge runtime)
  if (typeof globalThis.Bun === "undefined") return;

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
