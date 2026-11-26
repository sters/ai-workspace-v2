import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { readArtifact } from "@/lib/workspace/artifacts";

/**
 * One artifact's content, named by `?path=` relative to `artifacts/`.
 *
 * `readArtifact` is what decides whether that path is readable at all — it
 * refuses anything resolving outside the directory — so a refusal and a missing
 * file are the same 404 here.
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

  const relPath = new URL(request.url).searchParams.get("path");
  if (!relPath) {
    return Response.json({ error: "Missing path" }, { status: 400 });
  }

  const file = await readArtifact(path.join(getWorkspaceDir(), name), relPath);
  if (!file) {
    return Response.json({ error: "Artifact not found" }, { status: 404 });
  }

  return Response.json(file);
}
