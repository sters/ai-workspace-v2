import { listSnippets, insertSnippet } from "@/lib/db";
import { snippetCreateSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { SNIPPET_KINDS, type SnippetKind } from "@/types/snippet";

export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind") ?? "init";
  if (!(SNIPPET_KINDS as readonly string[]).includes(kind)) {
    return Response.json({ error: `Unknown snippet kind: ${kind}` }, { status: 400 });
  }
  const snippets = listSnippets(kind as SnippetKind);
  return Response.json({ snippets });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(snippetCreateSchema, body);
  if (!parsed.success) return parsed.response;

  const snippet = insertSnippet(parsed.data);
  return Response.json(snippet);
}
