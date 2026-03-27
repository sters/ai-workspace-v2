import { NextResponse } from "next/server";
import { getResearchReport } from "@/lib/workspace/reader";

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
  const report = await getResearchReport(name);
  if (report === null) {
    return new NextResponse("", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new NextResponse(report, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
