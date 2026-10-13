import { NextResponse } from "next/server";
import { updateChatStartPrompt } from "@/lib/db";
import { chatStartPromptUpdateSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(chatStartPromptUpdateSchema, body);
  if (!parsed.success) return parsed.response;

  const prompt = updateChatStartPrompt(parsed.data.id, {
    title: parsed.data.title,
    content: parsed.data.content,
  });
  if (!prompt) {
    return NextResponse.json({ error: "Chat start prompt not found" }, { status: 404 });
  }
  return NextResponse.json(prompt);
}
