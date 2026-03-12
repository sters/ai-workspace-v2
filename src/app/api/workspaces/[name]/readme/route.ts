import { NextResponse } from "next/server";
import { getReadme } from "@/lib/workspace/reader";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const readme = await getReadme(name);
  if (readme === null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(readme, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
