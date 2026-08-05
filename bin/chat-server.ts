/**
 * Entry point to start the chat WebSocket server.
 * Usage: bun run bin/chat-server.ts
 */

import { startChatServer } from "../src/lib/chat-server";

const port = parseInt(process.env.AIW_CHAT_PORT || "3742", 10);
const server = startChatServer(port);

console.log(`[chat-server] WebSocket server listening on ws://localhost:${server.port}/ws`);

// Announce our own shutdown. Without this the process dies silently, so a
// whole-tree teardown looks like it originated wherever the noise came from.
function shutdown(signal: string): void {
  console.log(`[chat-server] received ${signal}, stopping…`);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
