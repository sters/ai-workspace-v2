import { NextResponse } from "next/server";
import { chatSessionKillSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(chatSessionKillSchema, body);
  if (!parsed.success) return parsed.response;
  const { sessionId } = parsed.data;

  const chatPort = getConfig().server.chatPort;

  try {
    const res = await fetch(`http://localhost:${chatPort}/sessions/kill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      console.error(`[chat-sessions/kill] Non-JSON response (${res.status}): ${text}`);
      return NextResponse.json(
        { error: `Chat server returned unexpected response: ${text}` },
        { status: 502 }
      );
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("[chat-sessions/kill] Chat server unreachable:", err);
    return NextResponse.json(
      { error: "Chat server unreachable" },
      { status: 502 }
    );
  }
}
