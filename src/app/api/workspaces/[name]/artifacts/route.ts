import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { listArtifacts } from "@/lib/workspace/artifacts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return Response.json({ error: "Invalid workspace name" }, { status: 400 });
  }

  return Response.json(await listArtifacts(path.join(getWorkspaceDir(), name)));
}
