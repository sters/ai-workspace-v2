import { NextResponse } from "next/server";
import { dismissLessonChallenges, getLesson, setLessonStatus, updateLessonText } from "@/lib/db/repo-lessons";
import { writeLessonsFile } from "@/lib/lessons";
import { repoLessonUpdateSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = parseBody(repoLessonUpdateSchema, await request.json().catch(() => ({})));
  if (!parsed.success) return parsed.response;

  const lesson = getLesson(id);
  if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });

  if (parsed.data.text) updateLessonText(id, parsed.data.text);
  if (parsed.data.status) setLessonStatus(id, parsed.data.status);
  if (parsed.data.dismissChallenges) dismissLessonChallenges(id);
  await writeLessonsFile(lesson.repoKey);
  return NextResponse.json(getLesson(id));
}
