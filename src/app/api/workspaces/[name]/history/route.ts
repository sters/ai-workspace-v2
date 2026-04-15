import { NextResponse } from "next/server";
import { getHistory } from "@/lib/workspace/reader";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name: rawName } = await params;
    const name = decodeURIComponent(rawName);
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
    }
    const url = new URL(request.url);
    const skip = Math.max(0, parseInt(url.searchParams.get("skip") ?? "0", 10) || 0);
    const { entries, hasMore } = getHistory(name, skip);
    return NextResponse.json({ entries, hasMore });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
