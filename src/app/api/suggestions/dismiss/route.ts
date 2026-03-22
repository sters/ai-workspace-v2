import { NextResponse } from "next/server";
import { dismissSuggestion } from "@/lib/db";
import { suggestionDismissSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = parseBody(suggestionDismissSchema, body);
  if (!parsed.success) return parsed.response;

  const ok = dismissSuggestion(parsed.data.id);
  if (!ok) {
    return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
