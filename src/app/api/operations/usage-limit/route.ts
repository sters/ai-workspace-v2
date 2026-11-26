import { listUsageLimitStops } from "@/lib/operation-store";

export function GET() {
  try {
    return Response.json(listUsageLimitStops());
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
