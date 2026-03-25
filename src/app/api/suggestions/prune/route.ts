import { NextResponse } from "next/server";
import { pruneSuggestions } from "@/lib/db";
import { suggestionPruneSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = parseBody(suggestionPruneSchema, body);
  if (!parsed.success) return parsed.response;

  const days = parsed.data.days && parsed.data.days > 0 ? parsed.data.days : 7;
  const deleted = pruneSuggestions(days);
  return NextResponse.json({ deleted, days });
}
