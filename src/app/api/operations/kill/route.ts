import { NextResponse } from "next/server";
import { killOperation } from "@/lib/pipeline-manager";
import { operationKillSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(operationKillSchema, body);
  if (!parsed.success) return parsed.response;

  const ok = killOperation(parsed.data.operationId);
  if (!ok) {
    return NextResponse.json(
      { error: "Operation not found or not running" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
