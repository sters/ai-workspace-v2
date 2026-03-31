"use client";

import useSWR from "swr";
import type { OperationListItem, OperationType } from "@/types/operation";
import { fetcher } from "@/lib/api";

/**
 * Expand a batch operation into the individual operation types it encompasses,
 * based on its `inputs.mode` and `inputs.startWith`.
 */
function expandBatchTypes(inputs?: Record<string, string>): OperationType[] {
  const types: OperationType[] = ["batch"];
  if (!inputs) return types;

  const mode = inputs.mode;
  const startWith = inputs.startWith;

  if (startWith === "update-todo") types.push("update-todo");
  if (startWith === "init") types.push("init");

  // All batch modes include execute
  types.push("execute");

  if (mode !== "execute-pr") types.push("review");
  if (mode !== "execute-review") types.push("create-pr");

  return types;
}

export function useRunningOperations() {
  const { data, mutate } = useSWR<OperationListItem[]>(
    "/api/operations?status=running",
    fetcher,
    { refreshInterval: 10000 },
  );

  const operations = data ?? [];

  const runningWorkspaces = new Set<string>();
  const runningWorkspaceTypes = new Map<string, Set<OperationType>>();
  /** Map of "workspace\0type\0repo" → true for operations targeting a specific repo. */
  const runningRepoOps = new Set<string>();
  /** Track which workspace+type combos have a workspace-wide (no repo) operation. */
  const workspaceWideOps = new Set<string>();

  for (const op of operations) {
    runningWorkspaces.add(op.workspace);
    let types = runningWorkspaceTypes.get(op.workspace);
    if (!types) {
      types = new Set();
      runningWorkspaceTypes.set(op.workspace, types);
    }
    if (op.type === "batch") {
      for (const t of expandBatchTypes(op.inputs)) types.add(t);
    } else {
      types.add(op.type);
    }

    // Track per-repo running state
    const repo = op.inputs?.repo;
    if (repo) {
      runningRepoOps.add(`${op.workspace}\0${op.type}\0${repo}`);
    } else {
      workspaceWideOps.add(`${op.workspace}\0${op.type}`);
    }
  }

  const isWorkspaceRunning = (workspace: string) =>
    runningWorkspaces.has(workspace);

  /** Check if a specific operation type (or any of the given types) is running for a workspace. */
  const isWorkspaceTypeRunning = (
    workspace: string,
    type: OperationType | OperationType[],
  ): boolean => {
    const types = runningWorkspaceTypes.get(workspace);
    if (!types) return false;
    if (Array.isArray(type)) return type.some((t) => types.has(t));
    return types.has(type);
  };

  /**
   * Check if a specific repo is blocked by a running operation of the given type.
   * Returns true if:
   * - A workspace-wide (no repo) operation of that type is running, OR
   * - A repo-specific operation of that type is running for this exact repo.
   */
  const isRepoTypeRunning = (
    workspace: string,
    type: OperationType,
    repo: string,
  ): boolean => {
    if (workspaceWideOps.has(`${workspace}\0${type}`)) return true;
    return runningRepoOps.has(`${workspace}\0${type}\0${repo}`);
  };

  return { operations, runningWorkspaces, isWorkspaceRunning, isWorkspaceTypeRunning, isRepoTypeRunning, mutate };
}
