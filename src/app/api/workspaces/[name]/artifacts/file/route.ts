import { NextResponse } from "next/server";
import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { readArtifact } from "@/lib/workspace/artifacts";

export const dynamic = "force-dynamic";

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
    return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
  }

  const relPath = new URL(request.url).searchParams.get("path");
  if (!relPath) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  const file = readArtifact(path.join(getWorkspaceDir(), name), relPath);
  if (!file) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  return NextResponse.json(file);
}
