import { NextResponse } from "next/server";
import { getReviewSessions } from "@/lib/workspace/reader";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
  }
  const reviews = await getReviewSessions(name);
  return NextResponse.json(reviews);
}
