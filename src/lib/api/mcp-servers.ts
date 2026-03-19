/**
 * Client-side API calls for MCP servers.
 */

import type { z } from "zod";
import type { mcpAddSchema, mcpRemoveSchema } from "@/lib/schemas";
import type { ApiResult } from "./client";
import { postJson } from "./client";

export type AddMcpServerParams = z.input<typeof mcpAddSchema>;
export type RemoveMcpServerParams = z.input<typeof mcpRemoveSchema>;

/** Add an MCP server. */
export async function addMcpServer(
  params: AddMcpServerParams,
): Promise<ApiResult<{ output?: string }>> {
  return postJson("/api/mcp-servers/add", params);
}

/** Remove an MCP server. */
export async function removeMcpServer(
  params: RemoveMcpServerParams,
): Promise<ApiResult> {
  return postJson("/api/mcp-servers/remove", params);
}
