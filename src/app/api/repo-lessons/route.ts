import { NextResponse } from "next/server";
import { countCandidateLessons, listLessons } from "@/lib/db/repo-lessons";

export const dynamic = "force-dynamic";

/** Every lesson but superseded ones; `?count=candidates` answers only how many wait for review. */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("count") === "candidates") {
    return NextResponse.json({ candidates: countCandidateLessons() });
  }
  return NextResponse.json({ lessons: listLessons().filter((l) => l.status !== "superseded") });
}
