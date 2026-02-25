/**
 * Entry point to start the chat WebSocket server.
 * Usage: bun run bin/chat-server.ts
 */

import { startChatServer } from "../src/lib/chat-server";

const port = parseInt(process.env.CHAT_WS_PORT || "3742", 10);
const server = startChatServer(port);

console.log(`[chat-server] WebSocket server listening on ws://localhost:${server.port}/ws`);
