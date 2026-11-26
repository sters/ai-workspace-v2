import { dismissSuggestion } from "@/lib/db";
import { suggestionDismissSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = parseBody(suggestionDismissSchema, body);
  if (!parsed.success) return parsed.response;

  const ok = dismissSuggestion(parsed.data.id);
  if (!ok) {
    return Response.json({ error: "Suggestion not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
