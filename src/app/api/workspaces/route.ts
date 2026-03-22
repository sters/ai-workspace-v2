import { NextResponse } from "next/server";
import { listWorkspaces } from "@/lib/workspace/reader";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const workspaces = await listWorkspaces();
    return NextResponse.json(workspaces);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
