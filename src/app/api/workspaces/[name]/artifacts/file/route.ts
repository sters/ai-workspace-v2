import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { readArtifact, resolveArtifactPath } from "@/lib/workspace/artifacts";

/**
 * One artifact's content, named by `?path=` relative to `artifacts/`; with
 * `&raw=1` the file itself, typed by its extension (a report's screenshots).
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

  const url = new URL(request.url);
  const relPath = url.searchParams.get("path");
  if (!relPath) {
    return Response.json({ error: "Missing path" }, { status: 400 });
  }

  if (url.searchParams.get("raw") === "1") {
    const full = await resolveArtifactPath(path.join(getWorkspaceDir(), name), relPath);
    const raw = full ? Bun.file(full) : null;
    if (!raw || !(await raw.exists())) {
      return Response.json({ error: "Artifact not found" }, { status: 404 });
    }
    return new Response(raw);
  }

  const file = await readArtifact(path.join(getWorkspaceDir(), name), relPath);
  if (!file) {
    return Response.json({ error: "Artifact not found" }, { status: 404 });
  }

  return Response.json(file);
}
