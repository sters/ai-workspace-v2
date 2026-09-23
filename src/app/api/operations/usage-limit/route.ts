import { NextResponse } from "next/server";
import { listUsageLimitStops } from "@/lib/operation-store";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(listUsageLimitStops());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
