import { NextResponse } from "next/server";
import { readWorkspaceFileDiff } from "@/lib/workspace/changes";

export const dynamic = "force-dynamic";

/**
 * One changed file's diff, named by `?repo=` (the worktree, relative to the
 * workspace) and `?path=` (relative to the worktree). A path that is not one of
 * the listed changes is the same 404 as a missing one.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
  }

  const search = new URL(request.url).searchParams;
  const repo = search.get("repo");
  const filePath = search.get("path");
  if (!repo || !filePath) {
    return NextResponse.json({ error: "Missing repo or path" }, { status: 400 });
  }

  const diff = readWorkspaceFileDiff(name, repo, filePath);
  if (!diff) {
    return NextResponse.json({ error: "Change not found" }, { status: 404 });
  }
  return NextResponse.json(diff);
}
