import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { loadReviewFindings, reviewDirPath } from "@/lib/workspace/review-findings";

export const dynamic = "force-dynamic";

/**
 * The review's structured findings, each resolved against the PR it would be
 * posted to: whether it can be anchored inline, and whether it is already there.
 *
 * Resolved here rather than at post time so the human ticking findings is not
 * choosing blind — see `diff-anchors.ts`. It costs `gh` round trips per
 * repository, which is why the hook does not revalidate on focus.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string; timestamp: string }> },
) {
  try {
    const { name: rawName, timestamp: rawTimestamp } = await params;
    const name = decodeURIComponent(rawName);
    if (name.includes("..") || name.includes("/") || name.includes("\\")) {
      return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
    }
    const timestamp = decodeURIComponent(rawTimestamp);
    if (timestamp.includes("..") || timestamp.includes("/") || timestamp.includes("\\")) {
      return NextResponse.json({ error: "Invalid timestamp" }, { status: 400 });
    }

    if (!existsSync(reviewDirPath(name, timestamp))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(await loadReviewFindings(name, timestamp));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
