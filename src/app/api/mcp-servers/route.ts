import { NextResponse } from "next/server";
import { readMcpServers } from "@/lib/claude/mcp";

export const dynamic = "force-dynamic";

export async function GET() {
  const servers = await readMcpServers();
  return NextResponse.json({ servers });
}
