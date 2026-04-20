import { NextResponse } from "next/server";
import { listSnippets, insertSnippet } from "@/lib/db";
import { snippetCreateSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  const snippets = listSnippets();
  return NextResponse.json({ snippets });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(snippetCreateSchema, body);
  if (!parsed.success) return parsed.response;

  const snippet = insertSnippet(parsed.data);
  return NextResponse.json(snippet);
}
