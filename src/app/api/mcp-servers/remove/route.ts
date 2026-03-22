import { NextResponse } from "next/server";
import { spawnClaudeSync } from "@/lib/claude/cli";
import { mcpRemoveSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(mcpRemoveSchema, body);
  if (!parsed.success) return parsed.response;
  const { name, scope } = parsed.data;

  const args = ["mcp", "remove"];
  if (scope) {
    args.push("--scope", scope);
  }
  args.push(name);

  const result = spawnClaudeSync({ args });
  const stdout = result.stdout.toString().trim();
  const stderr = result.stderr.toString().trim();

  if (!result.success) {
    return NextResponse.json(
      { error: stderr || "claude mcp remove failed", stdout },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, output: stdout || stderr });
}
