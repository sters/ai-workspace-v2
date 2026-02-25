/**
 * WebSocket server implementation for interactive Claude chat sessions.
 * Spawns Claude CLI in interactive mode (no -p) with a PTY and bridges
 * stdin/stdout between the browser (via xterm.js) and the process.
 *
 * This module only exports the server factory. To start the server,
 * use bin/chat-server.ts.
 */

import path from "node:path";
import {
  spawnTerminal,
  type DataListener,
  type TerminalSubprocess,
} from "./pty";
import { buildInitPrompt } from "./chat-prompt";

// ---------------------------------------------------------------------------
// Session management (globalThis for HMR survival)
// ---------------------------------------------------------------------------

interface ChatSession {
  id: string;
  workspaceId: string;
  proc: TerminalSubprocess;
  listeners: Set<DataListener>;
  exited: boolean;
}

const store = globalThis as unknown as {
  __chatSessions?: Map<string, ChatSession>;
  __chatCounter?: number;
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
// Resolve AI_WORKSPACE_ROOT
// ---------------------------------------------------------------------------

function getWorkspaceRoot(): string {
  return process.env.AI_WORKSPACE_ROOT || process.cwd();
}

// ---------------------------------------------------------------------------
// WebSocket message types
// ---------------------------------------------------------------------------

interface StartMessage {
  type: "start";
  workspaceId: string;
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

type ClientMessage = StartMessage | InputMessage | ResizeMessage | KillMessage;

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

type ServerMessage =
  | ServerOutputMessage
  | ServerStartedMessage
  | ServerExitedMessage
  | ServerErrorMessage;

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
  const server = Bun.serve<WsData>({
    port,
    fetch(req, server) {
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
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(_ws) {
        console.log("[chat-server] WebSocket connected");
      },
      message(ws, raw) {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
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

            const sessionId = nextSessionId();
            wsData.sessionId = sessionId;

            const listeners = new Set<DataListener>();
            const root = getWorkspaceRoot();
            const workspacePath = path.join(root, "workspace", msg.workspaceId);
            const env: Record<string, string | undefined> = {
              ...process.env,
              CLAUDECODE: undefined,
            };

            const initPrompt = buildInitPrompt(msg.workspaceId, workspacePath);

            let proc: TerminalSubprocess;
            try {
              proc = spawnTerminal(["claude", initPrompt], { cwd: root, env }, listeners);
            } catch {
              // Fallback: try with full path
              try {
                proc = spawnTerminal(
                  [process.env.CLAUDE_PATH || "claude", initPrompt],
                  { cwd: root, env },
                  listeners,
                );
              } catch (err) {
                send(ws, {
                  type: "error",
                  message: `Failed to spawn claude: ${err}`,
                });
                return;
              }
            }

            const session: ChatSession = {
              id: sessionId,
              workspaceId: msg.workspaceId,
              proc,
              listeners,
              exited: false,
            };
            store.__chatSessions!.set(sessionId, session);

            // Forward PTY output to WebSocket
            const outputListener: DataListener = (data) => {
              send(ws, { type: "output", data });
            };
            listeners.add(outputListener);

            // Track process exit
            proc.exited.then((code) => {
              session.exited = true;
              send(ws, { type: "exited", code });
              store.__chatSessions!.delete(sessionId);
            });

            send(ws, { type: "started", sessionId });

            console.log(
              `[chat-server] Session ${sessionId} started for workspace "${msg.workspaceId}"`,
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
            break;
          }
        }
      },
      close(ws) {
        const wsData = ws.data;
        if (wsData.sessionId) {
          const session = store.__chatSessions!.get(wsData.sessionId);
          if (session && !session.exited) {
            session.proc.kill();
          }
          store.__chatSessions!.delete(wsData.sessionId);
          console.log(`[chat-server] Session ${wsData.sessionId} closed`);
        }
      },
    },
  });

  return server;
}
