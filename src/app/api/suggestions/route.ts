import { NextResponse } from "next/server";
import { listActiveSuggestions } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const suggestions = listActiveSuggestions();
    return NextResponse.json(suggestions);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
