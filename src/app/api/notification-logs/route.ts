import { getNotificationLogs } from "@/lib/db/notification-logs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Math.min(Number(params.get("limit")) || 50, 200);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);

  const result = getNotificationLogs(limit, offset);
  return Response.json(result);
}
