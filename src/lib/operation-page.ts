import path from "node:path";
import { pathExists } from "@/lib/fs";
import { getWorkspaceDir } from "@/lib/config";
import { getOperationListItem } from "@/lib/db";
import { getOperationSummaries } from "@/lib/pipeline-manager";
import type { OperationListItem } from "@/types/operation";

/**
 * Where `/operations/<id>` shows an operation. One that belongs to a workspace
 * is shown in that workspace's Operations tab; the rest — utilities, scheduled
 * tasks, discovery, and operations of a deleted workspace — are filed under a
 * label that names no workspace and get a page of their own.
 */
export type OperationPage =
  | { kind: "workspace"; href: string }
  | { kind: "standalone"; operation: OperationListItem };

/** Same test as the workspace listing: a directory with a README. */
async function isWorkspace(name: string): Promise<boolean> {
  if (!name || name !== path.basename(name) || name === "." || name === "..") return false;
  return pathExists(path.join(getWorkspaceDir(), name, "README.md"));
}

export async function resolveOperationPage(id: string): Promise<OperationPage | null> {
  const operation =
    getOperationSummaries().find((op) => op.id === id) ?? getOperationListItem(id);
  if (!operation) return null;
  if (await isWorkspace(operation.workspace)) {
    return {
      kind: "workspace",
      href: `/workspace/${encodeURIComponent(operation.workspace)}/operations?operationId=${encodeURIComponent(operation.id)}`,
    };
  }
  return { kind: "standalone", operation };
}
