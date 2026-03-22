import { NextResponse } from "next/server";
import { spawnClaudeSync } from "@/lib/claude/cli";
import { mcpAddSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(mcpAddSchema, body);
  if (!parsed.success) return parsed.response;
  const { name, transport, url, scope } = parsed.data;

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

  return NextResponse.json({ ok: true, output: stdout || stderr });
}
