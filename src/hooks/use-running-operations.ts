import useSWR from "swr";
import type { Operation } from "@/types/operation";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useRunningOperations() {
  const { data, mutate } = useSWR<Operation[]>("/api/operations", fetcher, {
    refreshInterval: 3000,
  });

  const operations = data ?? [];

  const runningWorkspaces = new Set<string>();
  for (const op of operations) {
    if (op.status === "running") {
      runningWorkspaces.add(op.workspace);
    }
  }

  const isWorkspaceRunning = (workspace: string) =>
    runningWorkspaces.has(workspace);

  return { operations, runningWorkspaces, isWorkspaceRunning, mutate };
}
