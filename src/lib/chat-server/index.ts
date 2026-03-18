/**
 * WebSocket server implementation for interactive Claude chat sessions.
 * Spawns Claude CLI in interactive mode (no -p) with a PTY and bridges
 * stdin/stdout between the browser (via xterm.js) and the process.
 *
 * This module only exports the server factory. To start the server,
 * use bin/chat-server.ts.
 */

import { clientMessageSchema } from "../runtime-schemas";
import type { ClientMessage, WsData } from "@/types/chat-server";
import { send } from "./handlers";
import { GC_INTERVAL_MS } from "./constants";
import { getStore } from "./store";
import { runGc } from "./gc";
import { handleStart, handleResume, handleInput, handleKill, handleClose } from "./handlers";
import { handleHealthCheck, handleSessionKill, handleSessionsList } from "./routes";

// Re-exports for testing
export { trimBuffer } from "./buffer";
export { gcSessions } from "./gc";
export { BUFFER_HIGH, BUFFER_LOW, GC_MAX_AGE_MS, GC_MAX_EXITED } from "./constants";

export function startChatServer(port: number) {
  const store = getStore();

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
        return handleHealthCheck();
      }
      // Kill a chat session
      if (url.pathname === "/sessions/kill" && req.method === "POST") {
        return handleSessionKill(req);
      }
      // Active chat sessions
      if (url.pathname === "/sessions") {
        return handleSessionsList();
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

        switch (msg.type) {
          case "start":
            handleStart(ws, msg);
            break;
          case "resume":
            handleResume(ws, msg);
            break;
          case "input":
            handleInput(ws, msg);
            break;
          case "resize":
            // PTY resize is not directly supported by Bun.spawn terminal option yet.
            // This is a no-op for now but the protocol supports it for future use.
            break;
          case "kill":
            handleKill(ws);
            break;
        }
      },
      close(ws) {
        handleClose(ws);
      },
    },
  });

  return server;
}
