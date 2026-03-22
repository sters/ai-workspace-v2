import { NextResponse } from "next/server";
import { deleteOperation } from "@/lib/pipeline-manager";
import { deleteStoredOperation } from "@/lib/operation-store";
import { operationClearSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(operationClearSchema, body);
  if (!parsed.success) return parsed.response;

  const memoryOk = deleteOperation(parsed.data.operationId);
  const diskOk = deleteStoredOperation(parsed.data.operationId);

  if (!memoryOk && !diskOk) {
    return NextResponse.json(
      { error: "Operation not found or still running" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
