import { NextResponse } from "next/server";
import type { ChatSessionInfo } from "@/types/chat";

const CHAT_WS_PORT = process.env.CHAT_WS_PORT || "3742";

export async function GET() {
  try {
    const res = await fetch(`http://localhost:${CHAT_WS_PORT}/sessions`);
    const sessions: ChatSessionInfo[] = await res.json();
    return NextResponse.json(sessions);
  } catch {
    // Chat server unreachable — return empty array
    return NextResponse.json([]);
  }
}
