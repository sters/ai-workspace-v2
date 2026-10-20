import { resolveWorkspacePath } from "@/lib/config";
import { listRunningOperations } from "@/lib/db/operations";
import { getThreadWorkspace } from "@/lib/db/slack-thread-workspaces";
import { pathExists } from "@/lib/fs";

export interface ResolvedBoundWorkspace {
  name: string;
  path: string;
  /** Type of an operation running on the workspace now, if any. */
  runningOperation?: string;
}

/**
 * The workspace a thread is bound to, as it stands now. Undefined when none was
 * bound or the workspace has since been deleted — the thread then goes back to
 * the unbound conversation. Running operations are read from the database,
 * since they run in the Next.js process, not this one.
 */
export async function resolveBoundWorkspace(threadKey: string): Promise<ResolvedBoundWorkspace | undefined> {
  const name = getThreadWorkspace(threadKey);
  if (!name) return undefined;
  const dir = resolveWorkspacePath(name);
  if (!dir || !(await pathExists(dir))) return undefined;
  const running = listRunningOperations().find((op) => op.workspace === name);
  return { name, path: dir, runningOperation: running?.type };
}
