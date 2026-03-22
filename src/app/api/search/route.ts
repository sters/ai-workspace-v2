import { NextResponse } from "next/server";
import { quickSearchWorkspaces } from "@/lib/workspace/reader";
import type { QuickSearchResponse } from "@/types/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim();

    if (!query) {
      return NextResponse.json({ error: "q parameter is required" }, { status: 400 });
    }

    const results = await quickSearchWorkspaces(query);
    const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);

    const response: QuickSearchResponse = { query, results, totalMatches };
    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
