import { NextResponse } from "next/server";
import { workspaceSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(workspaceSchema, body);
  if (!parsed.success) return parsed.response;

  const proc = Bun.spawn(["code", parsed.data.workspace], {
    stdout: "ignore",
    stderr: "pipe",
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    return NextResponse.json(
      { error: stderr || "Failed to open vscode" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
