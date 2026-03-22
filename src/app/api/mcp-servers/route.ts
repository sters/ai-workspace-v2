import { NextResponse } from "next/server";
import { readMcpServers } from "@/lib/claude/mcp";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const servers = await readMcpServers();
    return NextResponse.json({ servers });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
