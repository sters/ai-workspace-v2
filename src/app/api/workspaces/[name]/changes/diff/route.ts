import { readWorkspaceFileDiff } from "@/lib/workspace/changes";

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
    return Response.json({ error: "Invalid workspace name" }, { status: 400 });
  }

  const search = new URL(request.url).searchParams;
  const repo = search.get("repo");
  const filePath = search.get("path");
  if (!repo || !filePath) {
    return Response.json({ error: "Missing repo or path" }, { status: 400 });
  }

  const diff = await readWorkspaceFileDiff(name, repo, filePath);
  if (!diff) {
    return Response.json({ error: "Change not found" }, { status: 404 });
  }
  return Response.json(diff);
}
