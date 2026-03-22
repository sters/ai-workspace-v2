import { NextResponse } from "next/server";
import { getWorkspaceSummary } from "@/lib/workspace/reader";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name: rawName } = await params;
    const name = decodeURIComponent(rawName);
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
    }
    const summary = await getWorkspaceSummary(name);
    if (!summary) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
