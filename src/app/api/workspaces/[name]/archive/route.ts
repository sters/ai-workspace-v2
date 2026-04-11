import { NextResponse } from "next/server";
import {
  archiveWorkspace,
  unarchiveWorkspace,
  isWorkspaceArchived,
} from "@/lib/db/archives";

export const dynamic = "force-dynamic";

/** Toggle archive status for a workspace. */
export async function POST(
  _request: Request,
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

    const wasArchived = isWorkspaceArchived(name);
    if (wasArchived) {
      unarchiveWorkspace(name);
    } else {
      archiveWorkspace(name);
    }

    return NextResponse.json({ archived: !wasArchived });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
