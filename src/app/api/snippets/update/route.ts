import { NextResponse } from "next/server";
import { updateSnippet } from "@/lib/db";
import { snippetUpdateSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(snippetUpdateSchema, body);
  if (!parsed.success) return parsed.response;

  const snippet = updateSnippet(parsed.data.id, {
    title: parsed.data.title,
    content: parsed.data.content,
  });
  if (!snippet) {
    return NextResponse.json({ error: "Snippet not found" }, { status: 404 });
  }
  return NextResponse.json(snippet);
}
