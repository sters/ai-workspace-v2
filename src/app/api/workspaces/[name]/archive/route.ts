import { NextResponse } from "next/server";
import { isWorkspaceArchived, unarchiveWorkspace } from "@/lib/db/archives";
import { archiveWorkspaceSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { archiveWorkspaceWithPrs, OpenPullRequestsError } from "@/lib/workspace/archive";

export const dynamic = "force-dynamic";

/**
 * Toggle archive status for a workspace. Archiving with open PRs answers 409
 * with the list unless the body says `closeOpenPrs: true`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name: rawName } = await params;
    const name = decodeURIComponent(rawName);
    if (name.includes("..") || name.includes("/") || name.includes("\\")) {
      return NextResponse.json(
        { error: "Invalid workspace name" },
        { status: 400 },
      );
    }

    if (isWorkspaceArchived(name)) {
      unarchiveWorkspace(name);
      return NextResponse.json({ archived: false });
    }

    const parsed = parseBody(archiveWorkspaceSchema, await request.json().catch(() => ({})));
    if (!parsed.success) return parsed.response;
    const result = await archiveWorkspaceWithPrs(name, { closeOpenPrs: parsed.data.closeOpenPrs });
    return NextResponse.json({ archived: true, ...result });
  } catch (err) {
    if (err instanceof OpenPullRequestsError) {
      return NextResponse.json(
        { error: err.message, openPullRequests: err.pullRequests },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
