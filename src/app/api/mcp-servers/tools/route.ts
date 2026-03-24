import { NextResponse } from "next/server";
import { getMcpTools } from "@/lib/claude/mcp";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tools = await getMcpTools();
    return NextResponse.json({ tools });
  } catch (err) {
    return NextResponse.json(
      { tools: [], error: String(err) },
      { status: 500 }
    );
  }
}
