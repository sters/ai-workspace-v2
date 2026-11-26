import type { ChatSessionInfo } from "@/types/chat";
import { getConfig } from "@/lib/config";

export async function GET() {
  try {
    const chatPort = getConfig().server.chatPort;
    const res = await fetch(`http://localhost:${chatPort}/sessions`);
    if (!res.ok) {
      return Response.json([]);
    }
    const sessions: ChatSessionInfo[] = await res.json();
    return Response.json(sessions);
  } catch {
    // Chat server unreachable — return empty array
    return Response.json([]);
  }
}
