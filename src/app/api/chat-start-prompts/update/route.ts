import { updateChatStartPrompt } from "@/lib/db";
import { chatStartPromptUpdateSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(chatStartPromptUpdateSchema, body);
  if (!parsed.success) return parsed.response;

  const prompt = updateChatStartPrompt(parsed.data.id, {
    title: parsed.data.title,
    content: parsed.data.content,
  });
  if (!prompt) {
    return Response.json({ error: "Chat start prompt not found" }, { status: 404 });
  }
  return Response.json(prompt);
}
