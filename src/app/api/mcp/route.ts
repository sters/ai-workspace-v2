import { handleMcpMessage, isLocalOrigin } from "@/lib/mcp/protocol";
import { MCP_TOOLS } from "./tools";

export async function POST(request: Request) {
  if (!isLocalOrigin(request.headers.get("origin"))) {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }
  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  const response = await handleMcpMessage(message, MCP_TOOLS);
  return response ? Response.json(response) : new Response(null, { status: 202 });
}

/** No server-initiated stream: every answer comes back on the POST that asked. */
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
