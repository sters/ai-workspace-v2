import { NextResponse } from "next/server";
import { deleteOperation } from "@/lib/pipeline-manager";
import { operationClearSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(operationClearSchema, body);
  if (!parsed.success) return parsed.response;

  const ok = deleteOperation(parsed.data.operationId);
  if (!ok) {
    return NextResponse.json(
      { error: "Operation not found or still running" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
