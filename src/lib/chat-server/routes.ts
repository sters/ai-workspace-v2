import type { ChatSessionInfo } from "@/types/chat";
import { isSessionBusy } from "./activity";
import { getStore, persistSessionDeleted } from "./store";
import { refuseStart, spawnSession } from "./handlers";
import { sessionStartRequestSchema } from "../runtime-schemas";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
  persistSessionDeleted(sessionId);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleSessionStart(req: Request): Promise<Response> {
  const parsed = sessionStartRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "workspaceId is required" }, 400);
  const msg = { type: "start" as const, ...parsed.data };

  const refusal = await refuseStart(msg);
  if (refusal) return json({ error: refusal }, 409);

  const outcome = await spawnSession(msg, null);
  if (!outcome.ok) return json({ error: outcome.error }, 500);
  return json({ sessionId: outcome.sessionId });
}

export function handleSessionsList(): Response {
  const store = getStore();
  const now = Date.now();
  const sessions: ChatSessionInfo[] = [];
  for (const session of store.__chatSessions!.values()) {
    if (!session.exited) {
      sessions.push({
        id: session.id,
        workspaceId: session.workspaceId,
        startedAt: session.startedAt,
        busy: isSessionBusy(session, now),
      });
    }
  }
  return new Response(JSON.stringify(sessions), {
    headers: { "Content-Type": "application/json" },
  });
}
