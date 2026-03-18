import { NextResponse } from "next/server";
import { workspaceSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { getConfig } from "@/lib/config";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(workspaceSchema, body);
  if (!parsed.success) return parsed.response;

  const terminalCmd = getConfig().terminal.replace("{path}", parsed.data.workspace);
  const args = terminalCmd.split(/\s+/);

  const proc = Bun.spawn(args, {
    stdout: "ignore",
    stderr: "pipe",
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    return NextResponse.json(
      { error: stderr || "Failed to open terminal" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
