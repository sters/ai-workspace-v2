import path from "node:path";
import { NextResponse } from "next/server";
import { getWorkspaceDir } from "@/lib/config";
import { getCachedPullRequests, PR_CACHE_TTL_MS } from "@/lib/workspace/pr-cache";
import { readPrValidations } from "@/lib/workspace/pr-validations";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name: rawName } = await params;
    const name = decodeURIComponent(rawName);
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
    }

    // The PR read is TTL-cached because it costs two `gh` round trips per
    // repository; `?refresh=1` is the tab's Refresh button asking past it. The
    // validations come off disk every time — they are local and cheap, and a
    // just-finished validate operation must show up immediately.
    const force = new URL(request.url).searchParams.get("refresh") !== null;
    const [{ pullRequests, problems }, store] = await Promise.all([
      getCachedPullRequests(name, { force }),
      readPrValidations(path.join(getWorkspaceDir(), name)),
    ]);

    return NextResponse.json({
      pullRequests,
      problems,
      validations: store.validations,
      cacheTtlMs: PR_CACHE_TTL_MS,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
