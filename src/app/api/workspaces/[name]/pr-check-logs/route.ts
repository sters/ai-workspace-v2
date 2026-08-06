import { NextResponse } from "next/server";
import { fetchPrCheckFailureLogs } from "@/lib/workspace/pr-check-logs";
import { prCheckLogsSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * The failing checks' logs, read on demand when a human ticks them for triage.
 *
 * A POST rather than part of the tab's GET: a log costs a `gh` round trip per
 * check and nobody reads it until they decide to act, while that GET runs on
 * every mount and focus. Per-check failures come back as a `reason` instead of a
 * non-200, so one unreadable log does not block the triage.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name: rawName } = await params;
    const name = decodeURIComponent(rawName);
    if (name.includes("..") || name.includes("/") || name.includes("\\")) {
      return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = parseBody(prCheckLogsSchema, body);
    if (!parsed.success) return parsed.response;

    const logs = await fetchPrCheckFailureLogs({
      workspace: name,
      checks: parsed.data.checks,
    });
    return NextResponse.json({ logs });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
