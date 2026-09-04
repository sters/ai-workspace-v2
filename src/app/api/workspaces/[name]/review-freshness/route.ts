import { NextResponse } from "next/server";
import { PR_CACHE_TTL_MS } from "@/lib/workspace/pr-cache";
import { loadReviewFreshness } from "@/lib/workspace/review-freshness";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name: rawName } = await params;
    const name = decodeURIComponent(rawName);
    if (name.includes("..") || name.includes("/") || name.includes("\\")) {
      return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
    }

    // The PR half rides the same TTL cache as the Pull Requests tab, so having
    // both open costs one `gh` read; `?refresh=1` asks past it.
    const force = new URL(request.url).searchParams.get("refresh") !== null;
    const result = await loadReviewFreshness(name, { force });

    return NextResponse.json({ ...result, cacheTtlMs: PR_CACHE_TTL_MS });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
