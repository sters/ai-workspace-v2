import { NextResponse } from "next/server";
import type { ChatSessionInfo } from "@/types/chat";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const chatPort = getConfig().server.chatPort;
    const res = await fetch(`http://localhost:${chatPort}/sessions`);
    if (!res.ok) {
      return NextResponse.json([]);
    }
    const sessions: ChatSessionInfo[] = await res.json();
    return NextResponse.json(sessions);
  } catch {
    // Chat server unreachable — return empty array
    return NextResponse.json([]);
  }
}
