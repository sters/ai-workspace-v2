import type { OperationListItem } from "@/types/operation";
import type { OperationLogAgeInfo } from "./types";
import {
  listOperations as dbListOperations,
  listOperationsWithAge as dbListOperationsWithAge,
  listRecentFinishedOperations as dbListRecentFinishedOperations,
} from "../db";
import { validateWorkspace } from "./constants";

/**
 * List stored operations as lightweight summaries.
 * Returns summaries sorted by startedAt descending (newest first).
 */
export function listStoredOperations(workspace?: string): OperationListItem[] {
  if (workspace && !validateWorkspace(workspace)) return [];
  return dbListOperations(workspace);
}

/**
 * List all stored operation logs with age information.
 * Used by the operation-prune pipeline to identify old logs.
 * Returns entries sorted by startedAt ascending (oldest first).
 */
export function listAllOperationLogsWithAge(staleDays: number): OperationLogAgeInfo[] {
  return dbListOperationsWithAge(staleDays);
}

/**
 * List recent finished (completed + failed) operations as lightweight summaries.
 * Returns summaries sorted by completedAt descending (newest first), capped at `limit`.
 */
export function listRecentFinishedOperations(limit: number): OperationListItem[] {
  return dbListRecentFinishedOperations(limit);
}
