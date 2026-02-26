import { NextResponse } from "next/server";
import { checkAuthStatus } from "@/lib/claude/login";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = await checkAuthStatus();
    const status = JSON.parse(raw);
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: String(err), loggedIn: false },
      { status: 500 },
    );
  }
}
