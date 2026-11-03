import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listClaudeRuns } from "@/lib/db";
import { summarizeClaudeRuns } from "@/lib/run-costs";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/** `days` = 0 (or absent) covers everything recorded. */
export async function GET(request: NextRequest) {
  const days = Math.max(Number(request.nextUrl.searchParams.get("days")) || 0, 0);
  const since = days > 0 ? new Date(Date.now() - days * DAY_MS).toISOString() : "";
  return NextResponse.json(summarizeClaudeRuns(listClaudeRuns(since)));
}
