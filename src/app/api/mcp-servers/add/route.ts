import { NextResponse } from "next/server";
import { spawnClaudeSync } from "@/lib/claude/cli";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const { name, transport, scope, url } = body as {
    name?: string;
    transport?: string;
    scope?: string;
    url?: string;
  };

  if (!name || !transport || !url) {
    return NextResponse.json(
      { error: "name, transport, and url are required" },
      { status: 400 }
    );
  }

  if (!["stdio", "sse", "http"].includes(transport)) {
    return NextResponse.json(
      { error: "transport must be one of: stdio, sse, http" },
      { status: 400 }
    );
  }

  const resolvedScope = scope === "local" ? "local" : "project";

  // TODO: Support env and headers options for MCP server configuration
  const args = ["mcp", "add", "--transport", transport, "--scope", resolvedScope, name, url];

  const result = spawnClaudeSync({ args });
  const stdout = result.stdout.toString().trim();
  const stderr = result.stderr.toString().trim();

  if (!result.success) {
    return NextResponse.json(
      { error: stderr || "claude mcp add failed", stdout },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, output: stdout || stderr });
}
