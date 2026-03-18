import { getStore } from "./store";

export function handleHealthCheck(): Response {
  return new Response("ok");
}

export async function handleSessionKill(req: Request): Promise<Response> {
  const store = getStore();
  const body = await req.json().catch(() => null);
  const sessionId = typeof body?.sessionId === "string" && body.sessionId ? body.sessionId : null;
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "sessionId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const session = store.__chatSessions!.get(sessionId);
  if (!session || session.exited) {
    return new Response(JSON.stringify({ error: "Session not found or already exited" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  session.proc.kill();
  store.__chatSessions!.delete(sessionId);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

export function handleSessionsList(): Response {
  const store = getStore();
  const sessions: Array<{ id: string; workspaceId: string; startedAt: number }> = [];
  for (const session of store.__chatSessions!.values()) {
    if (!session.exited) {
      sessions.push({
        id: session.id,
        workspaceId: session.workspaceId,
        startedAt: session.startedAt,
      });
    }
  }
  return new Response(JSON.stringify(sessions), {
    headers: { "Content-Type": "application/json" },
  });
}
