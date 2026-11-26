import { countLessonsAwaitingReview, listLessons } from "@/lib/db/repo-lessons";

/** Every lesson but superseded ones; `?count=review` answers only how many wait for a person. */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("count") === "review") {
    return Response.json(countLessonsAwaitingReview());
  }
  return Response.json({ lessons: listLessons().filter((l) => l.status !== "superseded") });
}
