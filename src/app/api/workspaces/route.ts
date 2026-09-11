import { NextRequest, NextResponse } from "next/server";
import { setupRepository } from "@/lib/pipelines/actions/setup-repository";
import { quickCreateWorkspaceSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { createQuickWorkspace } from "@/lib/workspace/quick-create";
import { listWorkspaceItems } from "@/lib/workspace/reader";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const recentOnly =
      request.nextUrl.searchParams.get("recentOnly") === "true";
    const includeArchived =
      request.nextUrl.searchParams.get("includeArchived") === "true";
    const result = await listWorkspaceItems({ recentOnly, includeArchived });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Create a workspace deterministically — no operation, no model call. It runs
 * to completion in the request because the only slow step is git: a worktree
 * off refs already on disk takes seconds, and a first-time clone is the one
 * case that makes the caller wait.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(quickCreateWorkspaceSchema, body);
  if (!parsed.success) return parsed.response;

  try {
    const result = await createQuickWorkspace(parsed.data, { setupRepository });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
