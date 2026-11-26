import { listActiveSuggestions } from "@/lib/db";

export async function GET() {
  try {
    const suggestions = listActiveSuggestions();
    return Response.json(suggestions);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
