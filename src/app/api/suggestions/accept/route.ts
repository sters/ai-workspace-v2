import { NextResponse } from "next/server";
import { getSuggestion, dismissSuggestion } from "@/lib/db";
import { suggestionAcceptSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = parseBody(suggestionAcceptSchema, body);
  if (!parsed.success) return parsed.response;

  const suggestion = getSuggestion(parsed.data.id);
  if (!suggestion) {
    return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  }

  dismissSuggestion(parsed.data.id);
  return NextResponse.json({ ok: true, suggestion });
}
