import { deleteChatStartPrompt } from "@/lib/db";
import { chatStartPromptDeleteSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(chatStartPromptDeleteSchema, body);
  if (!parsed.success) return parsed.response;

  if (!deleteChatStartPrompt(parsed.data.id)) {
    return Response.json({ error: "Chat start prompt not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
