import { NextRequest, NextResponse } from "next/server";
import { listWorkspaceItems } from "@/lib/workspace/reader";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const recentOnly =
      request.nextUrl.searchParams.get("recentOnly") === "true";
    const result = await listWorkspaceItems({ recentOnly });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
