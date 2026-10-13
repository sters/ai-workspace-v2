import { NextResponse } from "next/server";
import { listChatStartPrompts, insertChatStartPrompt } from "@/lib/db";
import { chatStartPromptCreateSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { buildStartPromptChatPrompt, getStartPromptChatSystemPrompt } from "@/lib/templates";

export const dynamic = "force-dynamic";

/** Placeholders the read-only preview shows where a real session has values. */
const PREVIEW_WORKSPACE_PATH = "<workspace-path>";
const PREVIEW_CONTENT_PLACEHOLDER = "<content of the selected start prompt>";

export async function GET() {
  return NextResponse.json({
    prompts: listChatStartPrompts(),
    basePrompt: buildStartPromptChatPrompt("<workspace>", PREVIEW_WORKSPACE_PATH, PREVIEW_CONTENT_PLACEHOLDER),
    systemPrompt: getStartPromptChatSystemPrompt(),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(chatStartPromptCreateSchema, body);
  if (!parsed.success) return parsed.response;
  return NextResponse.json(insertChatStartPrompt(parsed.data));
}
