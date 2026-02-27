import { NextResponse } from "next/server";
import { getClaudeVersion } from "@/lib/claude/version";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const version = getClaudeVersion();
    return NextResponse.json({ version });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
