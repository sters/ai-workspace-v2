import { NextResponse } from "next/server";
import { spawnClaudeSync } from "@/lib/claude/cli";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const { name, scope } = body as { name?: string; scope?: string };

  if (!name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }

  const args = ["mcp", "remove"];
  if (scope && ["local", "project", "user"].includes(scope)) {
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

  return NextResponse.json({ success: true, output: stdout || stderr });
}
