import { listWorkspaceChanges } from "@/lib/workspace/changes";
import type { WorkspaceChanges } from "@/types/changes";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return Response.json({ error: "Invalid workspace name" }, { status: 400 });
  }

  const body: WorkspaceChanges = { repos: await listWorkspaceChanges(name) };
  return Response.json(body);
}
