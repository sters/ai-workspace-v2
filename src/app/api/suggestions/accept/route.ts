import { getSuggestion, dismissSuggestion } from "@/lib/db";
import { suggestionAcceptSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = parseBody(suggestionAcceptSchema, body);
  if (!parsed.success) return parsed.response;

  const suggestion = getSuggestion(parsed.data.id);
  if (!suggestion) {
    return Response.json({ error: "Suggestion not found" }, { status: 404 });
  }

  dismissSuggestion(parsed.data.id);
  return Response.json({ ok: true, suggestion });
}
