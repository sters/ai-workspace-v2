/**
 * Client-side API calls for operations.
 */

import type { z } from "zod";
import type { operationKillSchema, workspaceSchema } from "@/lib/schemas";
import { postJson } from "./client";

export type KillOperationParams = z.input<typeof operationKillSchema>;
export type WorkspaceParams = z.input<typeof workspaceSchema>;

/** Kill a running operation by ID. */
export async function killOperation(operationId: string): Promise<void> {
  await postJson("/api/operations/kill", { operationId } satisfies KillOperationParams);
}

/** Open a workspace path in the configured editor. */
export async function openInEditor(targetPath: string): Promise<void> {
  const result = await postJson("/api/operations/open-editor", { workspace: targetPath } satisfies WorkspaceParams);
  if (!result.ok) console.error("Failed to open editor:", result.error);
}

/** Open a workspace path in the configured terminal. */
export async function openInTerminal(targetPath: string): Promise<void> {
  const result = await postJson("/api/operations/open-terminal", { workspace: targetPath } satisfies WorkspaceParams);
  if (!result.ok) console.error("Failed to open terminal:", result.error);
}
