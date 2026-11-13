import { NextResponse } from "next/server";
import { countLessonsAwaitingReview, listLessons } from "@/lib/db/repo-lessons";

export const dynamic = "force-dynamic";

/** Every lesson but superseded ones; `?count=review` answers only how many wait for a person. */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("count") === "review") {
    return NextResponse.json(countLessonsAwaitingReview());
  }
  return NextResponse.json({ lessons: listLessons().filter((l) => l.status !== "superseded") });
}
