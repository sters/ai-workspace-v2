import type { ManagedOperation } from "./types";

const globalStore = globalThis as unknown as {
  __aiWorkspaceOps?: Map<string, ManagedOperation>;
};

if (!globalStore.__aiWorkspaceOps) {
  globalStore.__aiWorkspaceOps = new Map();
}

export const operations = globalStore.__aiWorkspaceOps;

export function nextId(): string {
  return crypto.randomUUID();
}
