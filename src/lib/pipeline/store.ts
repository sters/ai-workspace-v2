import type { ManagedOperation } from "./types";

const globalStore = globalThis as unknown as {
  __aiWorkspaceOps?: Map<string, ManagedOperation>;
  __aiWorkspaceInterjects?: Set<string>;
};

if (!globalStore.__aiWorkspaceOps) {
  globalStore.__aiWorkspaceOps = new Map();
}
if (!globalStore.__aiWorkspaceInterjects) {
  globalStore.__aiWorkspaceInterjects = new Set();
}

export const operations = globalStore.__aiWorkspaceOps;
export const interjectsInFlight = globalStore.__aiWorkspaceInterjects;

export function nextId(): string {
  return crypto.randomUUID();
}

export function findRunningOpsByWorkspace(workspace: string): ManagedOperation[] {
  return [...operations.values()].filter(
    (managed) => managed.operation.workspace === workspace && managed.operation.status === "running",
  );
}
