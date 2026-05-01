import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { openSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { getConfig, resolveWorkspacePath } from "@/lib/config";
import { getCleanEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(openSchema, body);
  if (!parsed.success) return parsed.response;

  const workspacePath = resolveWorkspacePath(parsed.data.workspace);
  if (!workspacePath || !existsSync(workspacePath)) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const opener = getConfig().openers.find((o) => o.name === parsed.data.openerName);
  if (!opener) {
    return NextResponse.json(
      { error: `Unknown opener: ${parsed.data.openerName}` },
      { status: 404 },
    );
  }

  // subPath is sourced from workspace README repository metadata, but reject
  // traversal sequences and absolute paths defensively to avoid surprises.
  const sub = parsed.data.subPath?.trim();
  if (sub) {
    if (sub.includes("..") || path.isAbsolute(sub)) {
      return NextResponse.json(
        { error: "subPath must be a relative path without '..'" },
        { status: 400 },
      );
    }
  }
  const targetPath = sub ? path.join(workspacePath, sub) : workspacePath;

  // Run through `sh -c` so users can chain commands (`cd {path} && code .`,
  // `tmux new -s ws "{path}"`, etc.) and so paths with spaces are handled
  // correctly. The path is shell-quoted defensively even though it can only
  // come from a validated workspace + subPath; users can shoot themselves
  // in the foot via `command` (it's their config) but injected paths
  // shouldn't be able to.
  const quotedPath = `'${targetPath.replace(/'/g, `'\\''`)}'`;
  const finalCmd = opener.command.replaceAll("{path}", quotedPath);

  const proc = Bun.spawn(["sh", "-c", finalCmd], {
    stdout: "ignore",
    stderr: "pipe",
    env: getCleanEnv(),
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    return NextResponse.json(
      { error: stderr || `Failed to launch opener "${opener.name}"` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
