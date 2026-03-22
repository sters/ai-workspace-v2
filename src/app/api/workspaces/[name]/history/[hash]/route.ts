import { NextResponse } from "next/server";
import { getCommitDiff } from "@/lib/workspace/reader";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string; hash: string }> }
) {
  const { name: rawName, hash } = await params;
  const name = decodeURIComponent(rawName);
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
  }
  const diff = getCommitDiff(name, hash);
  if (diff === null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ diff });
}
