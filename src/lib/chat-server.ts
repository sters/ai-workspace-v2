/**
 * WebSocket server implementation for interactive Claude chat sessions.
 * Spawns Claude CLI in interactive mode (no -p) with a PTY and bridges
 * stdin/stdout between the browser (via xterm.js) and the process.
 *
 * This module only exports the server factory. To start the server,
 * use bin/chat-server.ts.
 */

import path from "node:path";
import { spawnClaudeTerminal } from "./claude/cli";
import type { DataListener, TerminalSubprocess } from "@/types/pty";
import { buildInitPrompt, buildReviewChatPrompt } from "@/lib/templates";
import { clientMessageSchema } from "./runtime-schemas";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum output buffer chunks before trimming */
export const BUFFER_HIGH = 5000;
/** Number of chunks to keep after trim */
export const BUFFER_LOW = 3000;
/** GC: max age (ms) for exited sessions before cleanup */
export const GC_MAX_AGE_MS = 10 * 60 * 1000;
/** GC: max number of exited sessions to keep */
export const GC_MAX_EXITED = 10;
/** GC interval (ms) */
const GC_INTERVAL_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Session management (globalThis for HMR survival)
// ---------------------------------------------------------------------------

interface ChatSession {
  id: string;
  workspaceId: string;
  proc: TerminalSubprocess;
  listeners: Set<DataListener>;
  exited: boolean;
  exitCode: number | null;
  outputBuffer: Uint8Array[];
  activeWs: { send(data: string): void } | null;
  exitedAt: number | null;
  startedAt: number;
}

const store = globalThis as unknown as {
  __chatSessions?: Map<string, ChatSession>;
  __chatCounter?: number;
  __chatGcTimer?: ReturnType<typeof setInterval>;
};

if (!store.__chatSessions) {
  store.__chatSessions = new Map();
}
if (store.__chatCounter == null) {
  store.__chatCounter = 0;
}

function nextSessionId(): string {
  return `chat-${++store.__chatCounter!}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Buffer management (exported for testing)
// ---------------------------------------------------------------------------

export function trimBuffer<T>(buffer: T[]): T[] {
  if (buffer.length > BUFFER_HIGH) {
    return buffer.slice(buffer.length - BUFFER_LOW);
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// GC (exported for testing)
// ---------------------------------------------------------------------------

export function gcSessions(sessions: Map<string, ChatSession>, now: number): number {
  let removed = 0;

  // Remove sessions that exited more than GC_MAX_AGE_MS ago
  for (const [id, session] of sessions) {
    if (session.exited && session.exitedAt != null && now - session.exitedAt > GC_MAX_AGE_MS) {
      sessions.delete(id);
      removed++;
    }
  }

  // If still too many exited sessions, remove oldest first
  const exitedSessions: Array<{ id: string; exitedAt: number }> = [];
  for (const [id, session] of sessions) {
    if (session.exited && session.exitedAt != null) {
      exitedSessions.push({ id, exitedAt: session.exitedAt });
    }
  }

  if (exitedSessions.length > GC_MAX_EXITED) {
    exitedSessions.sort((a, b) => a.exitedAt - b.exitedAt);
    const toRemove = exitedSessions.length - GC_MAX_EXITED;
    for (let i = 0; i < toRemove; i++) {
      sessions.delete(exitedSessions[i].id);
      removed++;
    }
  }

  return removed;
}

function runGc() {
  const removed = gcSessions(store.__chatSessions!, Date.now());
  if (removed > 0) {
    console.log(`[chat-server] GC removed ${removed} expired session(s)`);
  }
}

// ---------------------------------------------------------------------------
// Resolve workspace root
// ---------------------------------------------------------------------------

function getWorkspaceRoot(): string {
  return process.env.AIW_WORKSPACE_ROOT || process.cwd();
}

// ---------------------------------------------------------------------------
// WebSocket message types
// ---------------------------------------------------------------------------

interface StartMessage {
  type: "start";
  workspaceId: string;
  initialPrompt?: string;
  reviewTimestamp?: string;
}

interface InputMessage {
  type: "input";
  data: string;
}

interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

interface KillMessage {
  type: "kill";
}

interface ResumeMessage {
  type: "resume";
  sessionId: string;
}

type ClientMessage = StartMessage | InputMessage | ResizeMessage | KillMessage | ResumeMessage;

interface ServerOutputMessage {
  type: "output";
  data: string;
}

interface ServerStartedMessage {
  type: "started";
  sessionId: string;
}

interface ServerExitedMessage {
  type: "exited";
  code: number;
}

interface ServerErrorMessage {
  type: "error";
  message: string;
}

interface ServerResumedMessage {
  type: "resumed";
  sessionId: string;
  exited: boolean;
  exitCode?: number;
  bufferedChunks: number;
}

interface ServerReplayDoneMessage {
  type: "replay_done";
}

type ServerMessage =
  | ServerOutputMessage
  | ServerStartedMessage
  | ServerExitedMessage
  | ServerErrorMessage
  | ServerResumedMessage
  | ServerReplayDoneMessage;

// ---------------------------------------------------------------------------
// WebSocket server factory
// ---------------------------------------------------------------------------

interface WsData {
  sessionId: string | null;
}

function send(ws: { send(data: string): void }, msg: ServerMessage) {
  ws.send(JSON.stringify(msg));
}

export function startChatServer(port: number) {
  // Start GC timer (clear any previous from HMR)
  if (store.__chatGcTimer) {
    clearInterval(store.__chatGcTimer);
  }
  store.__chatGcTimer = setInterval(runGc, GC_INTERVAL_MS);

  const server = Bun.serve<WsData>({
    port,
    async fetch(req, server) {
      // Upgrade HTTP to WebSocket
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req, {
          data: { sessionId: null },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      // Health check
      if (url.pathname === "/health") {
        return new Response("ok");
      }
      // Kill a chat session
      if (url.pathname === "/sessions/kill" && req.method === "POST") {
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
      // Active chat sessions
      if (url.pathname === "/sessions") {
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
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(_ws) {
        console.log("[chat-server] WebSocket connected");
      },
      message(ws, raw) {
        let msg: ClientMessage;
        try {
          const parsed = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
          const result = clientMessageSchema.safeParse(parsed);
          if (!result.success) {
            const issues = result.error.issues.map((i) => i.message).join("; ");
            send(ws, { type: "error", message: `Invalid message: ${issues}` });
            return;
          }
          msg = result.data;
        } catch {
          send(ws, { type: "error", message: "Invalid JSON" });
          return;
        }

        const wsData = ws.data;

        switch (msg.type) {
          case "start": {
            if (wsData.sessionId) {
              // Kill existing session
              const existing = store.__chatSessions!.get(wsData.sessionId);
              if (existing && !existing.exited) {
                existing.proc.kill();
              }
              store.__chatSessions!.delete(wsData.sessionId);
            }

            // Run GC opportunistically
            runGc();

            const sessionId = nextSessionId();
            wsData.sessionId = sessionId;

            const listeners = new Set<DataListener>();
            const root = getWorkspaceRoot();
            const workspacePath = path.join(root, "workspace", msg.workspaceId);

            const initPrompt = msg.initialPrompt
              || (msg.reviewTimestamp
                ? buildReviewChatPrompt(msg.workspaceId, workspacePath, msg.reviewTimestamp)
                : buildInitPrompt(msg.workspaceId, workspacePath));

            let proc: TerminalSubprocess;
            try {
              proc = spawnClaudeTerminal({ args: [initPrompt], cwd: root, listeners });
            } catch (err) {
              send(ws, {
                type: "error",
                message: `Failed to spawn claude: ${err}`,
              });
              return;
            }

            const session: ChatSession = {
              id: sessionId,
              workspaceId: msg.workspaceId,
              proc,
              listeners,
              exited: false,
              exitCode: null,
              outputBuffer: [],
              activeWs: ws,
              exitedAt: null,
              startedAt: Date.now(),
            };
            store.__chatSessions!.set(sessionId, session);

            // Forward PTY output to buffer (raw bytes) + active WebSocket (decoded text)
            const outputListener: DataListener = (data, rawData) => {
              session.outputBuffer.push(rawData);
              session.outputBuffer = trimBuffer(session.outputBuffer);
              if (session.activeWs) {
                send(session.activeWs, { type: "output", data });
              }
            };
            listeners.add(outputListener);

            // Track process exit
            proc.exited.then((code) => {
              session.exited = true;
              session.exitCode = code;
              session.exitedAt = Date.now();
              if (session.activeWs) {
                send(session.activeWs, { type: "exited", code });
              }
            });

            send(ws, { type: "started", sessionId });

            console.log(
              `[chat-server] Session ${sessionId} started for workspace "${msg.workspaceId}"`,
            );
            break;
          }

          case "resume": {
            const session = store.__chatSessions!.get(msg.sessionId);
            if (!session) {
              send(ws, { type: "error", message: "Session not found" });
              return;
            }

            // Update session's active WebSocket
            session.activeWs = ws;
            wsData.sessionId = msg.sessionId;

            // Send resumed notification with buffer size
            send(ws, {
              type: "resumed",
              sessionId: session.id,
              exited: session.exited,
              exitCode: session.exitCode ?? undefined,
              bufferedChunks: session.outputBuffer.length,
            });

            // Replay buffered output — re-decode from raw bytes so multi-byte
            // UTF-8 characters that were split across chunks are decoded correctly.
            const replayDecoder = new TextDecoder();
            for (const chunk of session.outputBuffer) {
              const text = replayDecoder.decode(chunk, { stream: true });
              if (text) {
                send(ws, { type: "output", data: text });
              }
            }
            // Flush any trailing bytes held by the streaming decoder
            const trailing = replayDecoder.decode();
            if (trailing) {
              send(ws, { type: "output", data: trailing });
            }

            // Signal replay complete
            send(ws, { type: "replay_done" });

            console.log(
              `[chat-server] Session ${session.id} resumed (${session.outputBuffer.length} buffered chunks, exited=${session.exited})`,
            );
            break;
          }

          case "input": {
            const session = wsData.sessionId
              ? store.__chatSessions!.get(wsData.sessionId)
              : null;
            if (!session || session.exited) {
              send(ws, {
                type: "error",
                message: "No active session",
              });
              return;
            }
            session.proc.terminal.write(msg.data);
            break;
          }

          case "resize": {
            // PTY resize is not directly supported by Bun.spawn terminal option yet.
            // This is a no-op for now but the protocol supports it for future use.
            break;
          }

          case "kill": {
            const session = wsData.sessionId
              ? store.__chatSessions!.get(wsData.sessionId)
              : null;
            if (session && !session.exited) {
              session.proc.kill();
            }
            // Explicit kill: remove session entirely
            if (session) {
              store.__chatSessions!.delete(session.id);
            }
            break;
          }
        }
      },
      close(ws) {
        const wsData = ws.data;
        if (wsData.sessionId) {
          const session = store.__chatSessions!.get(wsData.sessionId);
          if (session) {
            // Detach WebSocket but keep session alive for resume
            session.activeWs = null;
            console.log(
              `[chat-server] WebSocket detached from session ${wsData.sessionId} (process continues)`,
            );
          }
        }
      },
    },
  });

  return server;
}
