/**
 * Client-side API calls for operations.
 */

import type { z } from "zod";
import type { openSchema, operationKillSchema } from "@/lib/schemas";
import { postJson } from "./client";

export type KillOperationParams = z.input<typeof operationKillSchema>;
export type OpenParams = z.input<typeof openSchema>;

/** Kill a running operation by ID. */
export async function killOperation(operationId: string): Promise<void> {
  await postJson("/api/operations/kill", { operationId } satisfies KillOperationParams);
}

/**
 * Launch a configured opener (editor / terminal / etc.) on a workspace path.
 *
 * - `workspace`: workspace name (e.g. `"my-task"`).
 * - `openerName`: must match a `name` in the user's `openers` config.
 * - `subPath`: optional relative path within the workspace (e.g. a repo dir).
 *
 * Throws on HTTP failure so callers can surface a toast to the user.
 */
export async function openWith(
  workspace: string,
  openerName: string,
  subPath?: string,
): Promise<void> {
  const result = await postJson(
    "/api/operations/open",
    { workspace, openerName, subPath } satisfies OpenParams,
  );
  if (!result.ok) {
    throw new Error(result.error || `Failed to launch opener "${openerName}"`);
  }
}
