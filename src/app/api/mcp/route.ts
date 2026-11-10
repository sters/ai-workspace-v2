import { NextResponse } from "next/server";
import { handleMcpMessage, isLocalOrigin } from "@/lib/mcp/protocol";
import { MCP_TOOLS } from "./tools";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isLocalOrigin(request.headers.get("origin"))) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }
  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  const response = await handleMcpMessage(message, MCP_TOOLS);
  return response ? NextResponse.json(response) : new Response(null, { status: 202 });
}

/** No server-initiated stream: every answer comes back on the POST that asked. */
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
