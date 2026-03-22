import { NextResponse } from "next/server";
import { getTodos } from "@/lib/workspace/reader";

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
    const todos = await getTodos(name);
    return NextResponse.json(todos);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
