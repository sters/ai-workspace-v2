import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { workspaceSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { getConfig, resolveWorkspacePath } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(workspaceSchema, body);
  if (!parsed.success) return parsed.response;

  const workspacePath = resolveWorkspacePath(parsed.data.workspace);
  if (!workspacePath || !existsSync(workspacePath)) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const terminalCmd = getConfig().terminal.replace("{path}", workspacePath);
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
