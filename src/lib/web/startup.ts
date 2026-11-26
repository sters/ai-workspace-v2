import { getDb, markAllSessionsExited } from "@/lib/db";
import { syncManagedHooks } from "@/lib/claude/hooks/sync";
import { failStaleOperations } from "@/lib/pipeline-manager";

const g = globalThis as unknown as { __aiwWebStartup?: Promise<void> };

/**
 * Once per web server process — a hot reload must not run it again, since it
 * would settle the operations running right now as interrupted.
 */
export function runWebServerStartup(): Promise<void> {
  g.__aiwWebStartup ??= (async () => {
    getDb();
    // Chat sessions recorded as live belong to a previous process.
    markAllSessionsExited();
    await syncManagedHooks().catch((err) => console.warn("[hooks] sync failed:", err));
    // Interrupted operations are settled, never resumed: their phases cannot
    // continue, and running them again repeats side effects.
    failStaleOperations();
  })();
  return g.__aiwWebStartup;
}
