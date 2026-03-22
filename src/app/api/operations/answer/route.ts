import { NextResponse } from "next/server";
import { submitAnswer } from "@/lib/pipeline-manager";
import { operationAnswerSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(operationAnswerSchema, body);
  if (!parsed.success) return parsed.response;

  const { operationId, toolUseId, answers } = parsed.data;

  const ok = submitAnswer(operationId, toolUseId, answers);
  if (!ok) {
    return NextResponse.json(
      { error: "Operation not found, not running, or no pending question" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
