import { NextResponse } from "next/server";
import type { ChatSessionInfo } from "@/types/chat";
import { getConfig } from "@/lib/config";

const CHAT_WS_PORT = getConfig().server.chatPort;

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
