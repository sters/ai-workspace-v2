import { NextResponse } from "next/server";
import { getMcpStatuses } from "@/lib/claude/mcp";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const statuses = getMcpStatuses();
    return NextResponse.json({ statuses });
  } catch (err) {
    return NextResponse.json(
      { statuses: [], error: String(err) },
      { status: 500 }
    );
  }
}
