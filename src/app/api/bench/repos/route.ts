import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listWorkspaceRepos } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace");
  if (!workspace) return NextResponse.json({ repos: [] });
  if (workspace.includes("..") || /[\\/]/.test(workspace)) {
    return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
  }
  const repos = await listWorkspaceRepos(workspace);
  return NextResponse.json({ repos: repos.map((r) => r.repoName) });
}
