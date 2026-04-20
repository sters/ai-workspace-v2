import { NextResponse } from "next/server";
import { deleteSnippet } from "@/lib/db";
import { snippetDeleteSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(snippetDeleteSchema, body);
  if (!parsed.success) return parsed.response;

  const ok = deleteSnippet(parsed.data.id);
  if (!ok) {
    return NextResponse.json({ error: "Snippet not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
