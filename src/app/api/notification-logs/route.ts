import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getNotificationLogs } from "@/lib/db/notification-logs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = Math.min(Number(params.get("limit")) || 50, 200);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);

  const result = getNotificationLogs(limit, offset);
  return NextResponse.json(result);
}
