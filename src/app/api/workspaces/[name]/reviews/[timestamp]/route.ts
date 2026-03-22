import { NextResponse } from "next/server";
import { getReviewDetail } from "@/lib/workspace/reader";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string; timestamp: string }> }
) {
  try {
    const { name: rawName, timestamp: rawTimestamp } = await params;
    const name = decodeURIComponent(rawName);
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
    }
    const timestamp = decodeURIComponent(rawTimestamp);
    if (timestamp.includes('..') || timestamp.includes('/') || timestamp.includes('\\')) {
      return NextResponse.json({ error: "Invalid timestamp" }, { status: 400 });
    }
    const detail = await getReviewDetail(name, timestamp);
    if (!detail) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
