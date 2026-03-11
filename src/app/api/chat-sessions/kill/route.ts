import { NextResponse } from "next/server";

const CHAT_WS_PORT = process.env.CHAT_WS_PORT || "3742";

export async function POST(request: Request) {
  const body = await request.json();
  const { sessionId } = body;

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(`http://localhost:${CHAT_WS_PORT}/sessions/kill`, {
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
