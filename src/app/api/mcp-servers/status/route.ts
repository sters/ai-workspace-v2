import { NextResponse } from "next/server";
import { execSync } from "node:child_process";
import { AI_WORKSPACE_ROOT } from "@/lib/config";
import type { McpConnectionStatus } from "@/types/claude";

export const dynamic = "force-dynamic";

/**
 * Parse `claude mcp list` output to get real connection status.
 *
 * Example output:
 *   atlassian: https://mcp.atlassian.com/v1/mcp (HTTP) - ! Needs authentication
 *   github: https://mcp.github.com/sse (SSE) - ✓ Connected
 *   filesystem: npx -y @modelcontextprotocol/server-filesystem (stdio) - ✓ Connected
 */
function parseClaudeMcpList(output: string): McpConnectionStatus[] {
  const results: McpConnectionStatus[] = [];
  for (const line of output.split("\n")) {
    // Match: name: ... - status
    const match = line.match(/^(\S+):\s.+\s-\s(.+)$/);
    if (!match) continue;

    const name = match[1];
    const statusText = match[2].trim();

    let status: McpConnectionStatus["status"] = "unknown";
    const lower = statusText.toLowerCase();
    if (lower.includes("needs authentication") || lower.includes("auth")) {
      status = "needs_auth";
    } else if (lower.includes("connected") || statusText.startsWith("✓")) {
      status = "ok";
    } else if (lower.includes("error") || lower.includes("failed") || statusText.startsWith("✗")) {
      status = "error";
    }

    results.push({ name, status, statusText });
  }
  return results;
}

export async function GET() {
  try {
    const output = execSync("claude mcp list", {
      encoding: "utf-8",
      cwd: AI_WORKSPACE_ROOT,
      timeout: 30_000,
    });
    const statuses = parseClaudeMcpList(output);
    return NextResponse.json({ statuses });
  } catch (err) {
    return NextResponse.json(
      { statuses: [], error: String(err) },
      { status: 500 }
    );
  }
}
