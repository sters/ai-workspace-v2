/** What the page needs from the server's environment: its version, and where the chat server listens. */
export function GET() {
  return Response.json({
    gitHash: process.env.AIW_GIT_HASH || "unknown",
    chatPort: Number(process.env.AIW_CHAT_PORT || "3742"),
  });
}
