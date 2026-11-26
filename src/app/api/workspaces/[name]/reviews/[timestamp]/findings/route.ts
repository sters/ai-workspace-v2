import { pathExists } from "@/lib/fs";
import { loadReviewFindings, reviewDirPath } from "@/lib/workspace/review-findings";

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
      return Response.json({ error: "Invalid workspace name" }, { status: 400 });
    }
    const timestamp = decodeURIComponent(rawTimestamp);
    if (timestamp.includes("..") || timestamp.includes("/") || timestamp.includes("\\")) {
      return Response.json({ error: "Invalid timestamp" }, { status: 400 });
    }

    if (!(await pathExists(reviewDirPath(name, timestamp)))) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return Response.json(await loadReviewFindings(name, timestamp));
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
